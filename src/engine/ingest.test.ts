// Any-format upload: the sample file converted to other formats must give exactly the same decisions.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook, parseWorkbookFrom } from './parse';
import { detectDelimiter, filesToWorkbook, type InputFile } from './ingest';
import { runAll } from './index';
import { buildCtx, readArrayBuffer, SAMPLE } from './testUtil';

const ctx = buildCtx();
const sampleWb = XLSX.read(readArrayBuffer(SAMPLE), { type: 'array' });
const baseline = runAll(parseWorkbook(readArrayBuffer(SAMPLE), 'sample.xlsx'), ctx);
/** Every applicant's decision and scores, in file order. Row numbers are left out: a CSV has no title row above the table. */
const decisions = (o: typeof baseline) => o.results.map((r) => `${r.appId} ${r.decision} ${r.partnerScore} ${r.combinedScore} ${r.territoryId}`);
const same = (o: typeof baseline) => expect(decisions(o)).toEqual(decisions(baseline));

const enc = (s: string): ArrayBuffer => {
  const b = new TextEncoder().encode(s);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const sheetName = (want: string) => sampleWb.SheetNames.find((n) => n.toLowerCase().includes(want))!;
const rowsOf = (want: string) => XLSX.utils.sheet_to_json<unknown[]>(sampleWb.Sheets[sheetName(want)], { header: 1, defval: '', raw: false });
const csvOf = (want: string, FS = ',') => XLSX.utils.sheet_to_csv(sampleWb.Sheets[sheetName(want)], { FS });

async function decide(files: InputFile[]) {
  const { wb, notes } = await filesToWorkbook(files);
  const parsed = parseWorkbookFrom(wb, files.map((f) => f.name).join(' + '), notes);
  return { parsed, out: runAll(parsed, ctx) };
}

/** Header row onwards, as plain string rows (drops the title banner). */
function tableRows(want: string): string[][] {
  const rows = rowsOf(want).map((r) => r.map((c) => String(c ?? '')));
  const h = rows.findIndex((r) => r.filter(Boolean).length >= 4);
  return rows.slice(h).filter((r) => r.some(Boolean));
}

describe('any-format upload', () => {
  it('reads two CSV files (applications + territories) the same as the Excel file', async () => {
    const { out, parsed } = await decide([
      { name: 'applications.csv', data: enc(csvOf('applic')) },
      { name: 'territories.csv', data: enc(csvOf('territor')) },
    ]);
    expect(parsed.applications.length).toBe(baseline.results.length);
    same(out);
  });

  it('detects semicolon, tab and pipe delimiters', async () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    const { out } = await decide([
      { name: 'apps.txt', data: enc(csvOf('applic', ';')) },
      { name: 'terr.tsv', data: enc(csvOf('territor', '\t')) },
    ]);
    same(out);
  });

  it('reads one CSV with both tables stacked one under the other', async () => {
    const { out } = await decide([{ name: 'everything.csv', data: enc(`${csvOf('applic')}\n\n${csvOf('territor')}`) }]);
    same(out);
  });

  it('reads JSON with Applications and Territories arrays', async () => {
    const toObjects = (want: string) => {
      const [head, ...rest] = tableRows(want);
      return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    };
    const json = JSON.stringify({ Applications: toObjects('applic'), Territories: toObjects('territor') });
    const { out } = await decide([{ name: 'export.json', data: enc(json) }]);
    same(out);
  });

  it('reads Markdown pipe tables', async () => {
    const md = (rows: string[][]) => [`| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => '---').join('|')}|`, ...rows.slice(1).map((r) => `| ${r.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
    const text = `# Applications\n\n${md(tableRows('applic'))}\n\n# Territories\n\n${md(tableRows('territor'))}\n`;
    const { parsed } = await decide([{ name: 'notes.md', data: enc(text) }]);
    expect(parsed.applications.length).toBe(baseline.results.length);
    expect(parsed.territories.length).toBe(baseline.territories.length);
  });

  it('reads tables from a Word .docx', async () => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tbl = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Applications</w:t></w:r></w:p>${tbl(tableRows('applic'))}${tbl(tableRows('territor'))}</w:body></w:document>`;
    const zip = XLSX.CFB.utils.cfb_new({ fileType: 'zip' } as never);
    XLSX.CFB.utils.cfb_add(zip, 'word/document.xml', new TextEncoder().encode(xml) as never);
    const bytes = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' } as never) as Uint8Array | number[];
    const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const { out } = await decide([{ name: 'applicants.docx', data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer }]);
    same(out);
  });

  it('accepts files with other column names and no ID column', async () => {
    const csv = ['Partner Name,Town,Postal code,Budget,Years of experience,Premises,Area (sq ft),Floor', 'Asha Rao,Mysore,570009,30 lakh,5,Own,600,Ground', 'Vik S,Bangalore,560100,₹40L,two,rented,500,ground floor'].join('\n');
    const { parsed } = await decide([{ name: 'leads.csv', data: enc(csv) }]);
    expect(parsed.applications.map((a) => [a.name, a.city, a.pin, a.investmentLakh, a.experienceYears, a.spaceAvailable])).toEqual([
      ['Asha Rao', 'Mysuru', '570009', 30, 5, 'Owned'],
      ['Vik S', 'Bengaluru', '560100', 40, 2, 'Rented'],
    ]);
  });

  it('refuses images and empty files with a clear reason', async () => {
    await expect(filesToWorkbook([{ name: 'scan.jpg', data: enc('x') }])).rejects.toThrow(/image/);
    await expect(filesToWorkbook([{ name: 'empty.csv', data: new ArrayBuffer(0) }])).rejects.toThrow(/empty/);
  });
});

describe('several applicant files', () => {
  it('adds applicants from a second file to the same batch', async () => {
    const extra = 'Partner Name;Town;Postal code;Budget;Years of experience\nAsha Rao;Mysore;570009;30 lakh;5';
    const { parsed } = await decide([
      { name: 'applications.csv', data: enc(csvOf('applic')) },
      { name: 'territories.csv', data: enc(csvOf('territor')) },
      { name: 'late-leads.csv', data: enc(extra) },
    ]);
    expect(parsed.applications.length).toBe(baseline.results.length + 1);
    expect(parsed.applications.at(-1)?.name).toBe('Asha Rao');
    expect(parsed.territories.length).toBe(baseline.territories.length);
  });
});
