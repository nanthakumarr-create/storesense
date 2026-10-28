// Any uploaded file(s) → one SheetJS workbook, so every format goes through the same parser and cleaning.
// Spreadsheets (xlsx, xls, xlsm, xlsb, ods, numbers, html, xml) are read by SheetJS; delimited text (csv, tsv,
// txt, semicolon or pipe separated) by delimiter detection; JSON as rows of objects; Markdown pipe tables;
// Word (.docx) tables from the document XML; PDF tables from the text layout. Several files are merged into one
// workbook (e.g. applications.csv + territories.csv). Images and other binaries are refused with a clear reason.
import * as XLSX from 'xlsx';

export interface InputFile {
  name: string;
  data: ArrayBuffer;
}

export interface Ingested {
  wb: XLSX.WorkBook;
  notes: string[];
}

type Cell = string | number | null;
type Table = { name: string; rows: Cell[][] };

const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|xltx|xltm|ods|fods|numbers|ots|xml|html?|dbf|sylk|slk|prn|dif|wk[1-4q]|qpw|wb[1-3])$/i;
const DELIMITED = /\.(csv|tsv|tab|txt|psv|dat|text)$/i;
const IMAGE = /\.(png|jpe?g|gif|bmp|webp|heic|heif|tiff?|svg)$/i;
const UNSUPPORTED = /\.(pptx?|key|zip|rar|7z|mp4|mov|mp3|wav|exe|dmg)$/i;

export const ACCEPTED_FORMATS = 'Excel (.xlsx, .xls, .xlsm, .xlsb), OpenDocument (.ods), Numbers, CSV, TSV, TXT, JSON, Markdown, HTML, Word (.docx) and PDF';

const baseName = (n: string) => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Sheet';
const ext = (n: string) => (n.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();

function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  // UTF-16 files (Excel's "Unicode text" export) start with a byte-order mark.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

/** True when the bytes look like text rather than a binary format. */
function looksLikeText(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data.slice(0, 4096));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return true;
  let odd = 0;
  for (const b of bytes) if (b === 0 || (b < 9 && b !== 0)) odd++;
  return odd < bytes.length * 0.01;
}

const isZip = (data: ArrayBuffer) => {
  const b = new Uint8Array(data.slice(0, 4));
  return b[0] === 0x50 && b[1] === 0x4b;
};
const isPdf = (data: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(data.slice(0, 5))) === '%PDF-';

// ---------- delimited text ----------
/** Pick the delimiter that splits the first lines into the most consistent number of columns. */
export function detectDelimiter(textIn: string): string {
  const lines = textIn.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const multi = counts.filter((c) => c > 1);
    if (!multi.length) continue;
    const mode = [...multi].sort((a, b) => multi.filter((x) => x === b).length - multi.filter((x) => x === a).length)[0];
    const score = multi.filter((c) => c === mode).length * mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Split one line on a delimiter, honouring double quotes ("a, b" stays one cell). */
function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === d && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const toCell = (s: string): Cell => {
  const t = s.trim();
  return t === '' ? null : t;
};

export function delimitedRows(textIn: string): Cell[][] {
  const d = detectDelimiter(textIn);
  // Join lines that sit inside an open quote (a note with a line break in it).
  const lines: string[] = [];
  let buf = '';
  for (const raw of textIn.split(/\r?\n/)) {
    buf = buf ? `${buf}\n${raw}` : raw;
    if ((buf.match(/"/g) ?? []).length % 2 === 0) {
      lines.push(buf);
      buf = '';
    }
  }
  if (buf) lines.push(buf);
  return lines.map((l) => splitLine(l, d).map(toCell));
}

// ---------- markdown ----------
export function markdownRows(textIn: string): Cell[][] | null {
  const lines = textIn.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (lines.length < 2) return null;
  const rows: Cell[][] = [];
  for (const l of textIn.split(/\r?\n/)) {
    if (!/^\s*\|.*\|\s*$/.test(l)) {
      if (rows.length && rows[rows.length - 1].length) rows.push([]); // blank row between tables
      continue;
    }
    const cells = l.trim().slice(1, -1).split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // |---|---|
    rows.push(cells.map(toCell));
  }
  return rows;
}

// ---------- JSON ----------
function jsonTables(textIn: string, name: string): Table[] {
  const data: unknown = JSON.parse(textIn);
  const fromList = (list: unknown[], sheet: string): Table | null => {
    const objs = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length) {
      const headers: string[] = [];
      for (const o of objs) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
      const cell = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === 'number' ? v : Array.isArray(v) ? v.join(', ') : String(v));
      return { name: sheet, rows: [headers, ...objs.map((o) => headers.map((h) => cell(o[h])))] };
    }
    const arrays = list.filter(Array.isArray) as unknown[][];
    if (arrays.length) return { name: sheet, rows: arrays.map((r) => r.map((v) => (v === null || v === undefined ? null : typeof v === 'number' ? v : String(v)))) };
    return null;
  };
  if (Array.isArray(data)) {
    const t = fromList(data, name);
    return t ? [t] : [];
  }
  if (data && typeof data === 'object') {
    // { "Applications": [...], "Territories": [...] } or { "data": [...] }
    const out: Table[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const t = fromList(v, k);
        if (t) out.push(t);
      }
    }
    return out;
  }
  return [];
}

// ---------- Word (.docx) ----------
const xmlText = (s: string) =>
  s
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

function docxTables(data: ArrayBuffer, name: string): Table[] {
  const zip = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
  const entry = XLSX.CFB.find(zip, 'word/document.xml') ?? XLSX.CFB.find(zip, '/word/document.xml');
  if (!entry?.content) throw new Error(`"${name}" is a zip file but not a Word document.`);
  const xml = new TextDecoder('utf-8').decode(entry.content as Uint8Array);
  const tables: Table[] = [];
  const tblRe = /<w:tbl>([\s\S]*?)<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = tblRe.exec(xml))) {
    n++;
    const rows = [...m[1].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) => [...tr[0].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((tc) => toCell(xmlText(tc[1]))));
    if (rows.length) tables.push({ name: `${baseName(name)} table ${n}`, rows });
  }
  if (tables.length) return tables;
  // No tables: read paragraphs as delimited lines (e.g. a tab- or comma-separated list typed into Word).
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => p[0].replace(/<w:tab\/>/g, '\t')).map((p) => xmlText(p.replace(/\t/g, '<<TAB>>')).replace(/<<TAB>>/g, '\t'));
  return [{ name: baseName(name), rows: delimitedRows(paras.join('\n')) }];
}

// ---------- PDF ----------
/** PDF text → rows: items on the same line are grouped by y; a wide horizontal gap starts a new cell. */
async function pdfTables(data: ArrayBuffer, name: string): Promise<Table[]> {
  const pdfjs = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const rows: Cell[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number; w: number; h: number };
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 10 });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Item[][] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Math.max(2, it.h * 0.4));
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let prevEnd = -Infinity;
      for (const it of line) {
        const gap = it.x - prevEnd;
        // Some PDFs put a whole row in one text run with wide spaces between columns.
        const [first, ...more] = it.str.split(/\s{2,}|\t/);
        if (cells.length && gap < it.h * 0.9) cells[cells.length - 1] += (gap > it.h * 0.15 ? ' ' : '') + first;
        else cells.push(first);
        cells.push(...more);
        prevEnd = it.x + it.w;
      }
      rows.push(cells.map(toCell));
    }
    rows.push([]);
  }
  return [{ name: baseName(name), rows }];
}

// ---------- workbook ----------
function workbookTables(wb: XLSX.WorkBook, name: string): Table[] {
  return wb.SheetNames.map((s) => ({
    name: wb.SheetNames.length === 1 && /^sheet\d*$/i.test(s) ? baseName(name) : s,
    rows: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[s], { header: 1, raw: true, defval: null, blankrows: true }),
  }));
}

async function tablesOf(file: InputFile): Promise<{ tables: Table[]; note?: string }> {
  const { name, data } = file;
  if (!data.byteLength) throw new Error(`"${name}" is empty.`);
  if (IMAGE.test(name)) throw new Error(`"${name}" is an image. Pictures of tables cannot be read reliably; please upload the data as ${ACCEPTED_FORMATS}.`);
  if (UNSUPPORTED.test(name)) throw new Error(`"${name}" is a .${ext(name)} file, which does not hold a table. Please upload ${ACCEPTED_FORMATS}.`);

  if (isPdf(data) || /\.pdf$/i.test(name)) return { tables: await pdfTables(data, name), note: `"${name}" was read from the PDF's text; check the numbers on a few applicants.` };
  if (/\.docx$/i.test(name) || (isZip(data) && /\.(doc|docm|dotx)$/i.test(name))) return { tables: docxTables(data, name), note: `"${name}" was read from the Word document's tables.` };
  if (/\.doc$/i.test(name)) throw new Error(`"${name}" is an old Word .doc file. Save it as .docx or .pdf and upload again.`);

  const textual = !isZip(data) && looksLikeText(data);
  const body = textual ? decodeText(data) : '';
  if (textual && (/\.json$/i.test(name) || /^\s*[[{]/.test(body))) {
    try {
      const tables = jsonTables(body, baseName(name));
      if (tables.length) return { tables };
    } catch {
      if (/\.json$/i.test(name)) throw new Error(`"${name}" is not valid JSON.`);
    }
  }
  if (textual && /\.(md|markdown)$/i.test(name)) {
    const rows = markdownRows(body);
    if (rows) return { tables: [{ name: baseName(name), rows }] };
  }
  if (textual && (DELIMITED.test(name) || !SPREADSHEET.test(name)) && !/^\s*</.test(body)) {
    const md = markdownRows(body);
    return { tables: [{ name: baseName(name), rows: md ?? delimitedRows(body) }] };
  }
  try {
    return { tables: workbookTables(XLSX.read(data, { type: 'array', cellDates: false }), name) };
  } catch {
    throw new Error(`"${name}" could not be read. Please upload ${ACCEPTED_FORMATS}.`);
  }
}

/** Sheet names must be unique and at most 31 characters. */
function uniqueName(want: string, taken: Set<string>): string {
  const clean = want.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = clean;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${clean.slice(0, 27)} (${i})`;
  taken.add(n.toLowerCase());
  return n;
}

export async function filesToWorkbook(files: InputFile[]): Promise<Ingested> {
  if (!files.length) throw new Error('No file selected.');
  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();
  const notes: string[] = [];
  for (const f of files) {
    const { tables, note } = await tablesOf(f);
    if (note) notes.push(note);
    for (const t of tables) {
      if (!t.rows.some((r) => r.some((c) => c !== null && c !== ''))) continue;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows), uniqueName(files.length > 1 && tables.length > 1 ? `${t.name}` : t.name, taken));
    }
  }
  if (!wb.SheetNames.length) throw new Error(`No table was found in ${files.map((f) => `"${f.name}"`).join(', ')}.`);
  return { wb, notes };
}

/** Label for the file name shown in the app ("a.csv + b.csv"). */
export const filesLabel = (files: { name: string }[]) => (files.length <= 2 ? files.map((f) => f.name).join(' + ') : `${files[0].name} + ${files.length - 1} more files`);
