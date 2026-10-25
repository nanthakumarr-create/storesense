// Excel → typed records + data flags.
// Contract: never throws on messy rows; flags them instead. Throws only when the file is not a workbook
// or has no recognisable Applications sheet (message is shown to the user as-is).
import * as XLSX from 'xlsx';
import type { Application, City, DataFlag, ExistingStore, Floor, Language, ParseResult, Priority, SpaceAvailable, Territory, Tier } from '../types';
import { CITY_PIN_PREFIX, CITY_TIER } from '../config/rules';
import { EXISTING_STORES } from '../data/existingStores';
import { cityFromPin } from './demand';
import { isBlank, matchCity, norm, text } from './util';

type Row = unknown[];
type Kind = 'apps' | 'terr' | 'stores';

// ---------- column matching ----------
type AppKey = 'id' | 'name' | 'city' | 'state' | 'pin' | 'investment' | 'experience' | 'business' | 'space' | 'size' | 'floor' | 'launch' | 'language' | 'notes';
type TerrKey = 'id' | 'city' | 'state' | 'pins' | 'tier' | 'slots' | 'priority';
type StoreKey = 'id' | 'city' | 'pin' | 'opened';

const APP_COLS: Record<AppKey, (h: string) => boolean> = {
  id: (h) => h === 'applicationid' || h === 'appid' || h === 'applicationno' || h === 'applicationnumber' || h === 'id',
  name: (h) => h === 'applicantname' || h === 'name' || h === 'applicant' || h === 'fullname',
  city: (h) => h === 'city',
  state: (h) => h === 'state',
  pin: (h) => h === 'pincode' || h === 'pin' || h === 'pincodes' || h === 'postalcode' || h === 'zip',
  investment: (h) => h.startsWith('investment') || h.includes('capital'),
  experience: (h) => h.includes('experience'),
  business: (h) => h.includes('business'),
  space: (h) => h === 'spaceavailable' || h === 'space' || h === 'spacestatus',
  size: (h) => h.includes('spacesize') || h.includes('sqft') || h === 'size',
  floor: (h) => h.startsWith('floor'),
  launch: (h) => h.includes('launch'),
  language: (h) => h.includes('language'),
  notes: (h) => h.includes('note') || h.includes('comment'),
};
const TERR_COLS: Record<TerrKey, (h: string) => boolean> = {
  id: (h) => h === 'territoryid' || h === 'territory' || h === 'id',
  city: (h) => h === 'city',
  state: (h) => h === 'state',
  pins: (h) => h.includes('pincode') || h.includes('pins'),
  tier: (h) => h.includes('tier'),
  slots: (h) => h.includes('slot'),
  priority: (h) => h.includes('priority'),
};
const STORE_COLS: Record<StoreKey, (h: string) => boolean> = {
  id: (h) => h === 'storeid' || h === 'store' || h === 'id',
  city: (h) => h === 'city',
  pin: (h) => h === 'pincode' || h === 'pin' || h === 'pin code',
  opened: (h) => h.startsWith('opened') || h.includes('year'),
};
const COLS: Record<Kind, Record<string, (h: string) => boolean>> = { apps: APP_COLS, terr: TERR_COLS, stores: STORE_COLS };
const KEY_COL: Record<Kind, string> = { apps: 'id', terr: 'pins', stores: 'id' };

function mapHeader(row: Row, kind: Kind): Record<string, number> {
  const out: Record<string, number> = {};
  const defs = COLS[kind];
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    for (const [k, test] of Object.entries(defs)) {
      if (out[k] === undefined && test(h)) {
        out[k] = i;
        break;
      }
    }
  });
  // Applications: a bare "id" column must not be confused with a territory sheet.
  if (kind === 'terr' && out.id !== undefined && out.pins === undefined) delete out.id;
  return out;
}

function findHeader(rows: Row[], kind: Kind): { index: number; map: Record<string, number>; score: number } | null {
  let best: { index: number; map: Record<string, number>; score: number } | null = null;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const map = mapHeader(rows[i] ?? [], kind);
    const score = Object.keys(map).length;
    const needed = kind === 'stores' ? 2 : 3;
    if (score >= needed && map[KEY_COL[kind]] !== undefined && (!best || score > best.score)) best = { index: i, map, score };
  }
  // Applications sheets are distinguished from others by the investment / experience columns.
  if (best && kind === 'apps' && best.map.investment === undefined && best.map.experience === undefined && best.map.pin === undefined) return null;
  if (best && kind === 'stores' && best.map.pin === undefined) return null;
  // "Allowed values" has City / Pin codes / City tier too; a territory sheet must also have slots or priority.
  if (best && kind === 'terr' && best.map.slots === undefined && best.map.priority === undefined) return null;
  return best;
}

const SHEET_NAME: Record<Kind, (n: string) => boolean> = {
  apps: (n) => n.includes('application') || n.includes('applicant'),
  terr: (n) => n.includes('territor'),
  stores: (n) => n.includes('existingstore') || n === 'stores' || n.includes('store'),
};

function rowsOf(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

function pickSheet(wb: XLSX.WorkBook, kind: Kind, used: Set<string>): { name: string; rows: Row[]; header: { index: number; map: Record<string, number> } } | null {
  const byName = wb.SheetNames.filter((n) => !used.has(n) && SHEET_NAME[kind](norm(n)));
  for (const n of byName) {
    const rows = rowsOf(wb.Sheets[n]);
    const header = findHeader(rows, kind);
    if (header) return { name: n, rows, header };
  }
  for (const n of wb.SheetNames) {
    if (used.has(n)) continue;
    const rows = rowsOf(wb.Sheets[n]);
    const header = findHeader(rows, kind);
    if (header) return { name: n, rows, header };
  }
  return null;
}

// ---------- value parsing ----------
const WORD_NUM: Record<string, number> = {
  zero: 0, nil: 0, none: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Best-effort number from a cell. `fromText` is true when the cell was text that needed cleaning. */
export function parseNumberCell(v: unknown): { value: number | null; fromText: boolean } {
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : null, fromText: false };
  const s = text(v).toLowerCase();
  if (!s) return { value: null, fromText: false };
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (m) {
    const asNum = Number(s.replace(/,/g, ''));
    return { value: Number(m[0]), fromText: !(Number.isFinite(asNum) && /^-?[\d.,]+$/.test(s)) };
  }
  const words = s.split(/[^a-z]+/).filter(Boolean);
  let total: number | null = null;
  for (const w of words) {
    if (WORD_NUM[w] !== undefined) total = (total ?? 0) + WORD_NUM[w];
  }
  return { value: total, fromText: true };
}

/** Investment in ₹ lakh: "30 lakh", "₹25L", "25,00,000", "2.5 cr". */
export function parseLakh(v: unknown): { value: number | null; fromText: boolean } {
  const raw = text(v).toLowerCase();
  const { value, fromText } = parseNumberCell(v);
  if (value === null) return { value: null, fromText };
  let lakh = value;
  if (/\bcr\b|crore/.test(raw)) lakh = value * 100;
  else if (value >= 10000) lakh = value / 100000; // typed in rupees
  return { value: Math.round(lakh * 100) / 100, fromText: fromText || lakh !== value };
}

/** Normalise a pin cell to a 6-digit string. */
export function parsePin(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 100000 && v <= 999999 ? String(v) : null;
  const digits = text(v).replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

function parseSpace(v: unknown): SpaceAvailable | null {
  const n = norm(v);
  if (!n) return null;
  if (n.startsWith('notyet') || n.startsWith('no') || n.includes('notidentified') || n.includes('searching') || n === 'none' || n === 'na') return 'Not yet identified';
  if (n.includes('own')) return 'Owned';
  if (n.includes('rent') || n.includes('lease')) return 'Rented';
  return null;
}
function parseFloor(v: unknown): Floor | null {
  const n = norm(v);
  if (!n) return null;
  if (n.includes('mall')) return 'Mall unit';
  if (n.includes('ground') || n === 'gf' || n === 'g') return 'Ground';
  if (n.includes('upper') || n.includes('first') || n.includes('1st') || n.includes('second') || n.includes('2nd') || n.includes('upstairs') || n.includes('top')) return 'Upper';
  if (n.includes('notknown') || n.includes('unknown') || n === 'na' || n.includes('notsure')) return 'Not known';
  return null;
}
const LANG_ALIASES: Record<string, Language> = { kannada: 'Kannada', kan: 'Kannada', kn: 'Kannada', english: 'English', eng: 'English', en: 'English', hindi: 'Hindi', hin: 'Hindi', hi: 'Hindi' };
function parseLanguage(v: unknown): { value: Language | null; all: Language[] } {
  const tokens = text(v).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const all: Language[] = [];
  for (const t of tokens) {
    const l = LANG_ALIASES[t];
    if (l && !all.includes(l)) all.push(l);
  }
  return { value: all[0] ?? null, all };
}
function parseTier(v: unknown): Tier | null {
  const n = norm(v).replace('tier', '').replace(/^t/, '');
  if (n === '1') return 'Tier 1';
  if (n === '2') return 'Tier 2';
  if (n === '3') return 'Tier 3';
  return null;
}
function parsePriority(v: unknown): Priority | null {
  const n = norm(v);
  if (n.startsWith('high') || n === 'h' || n === 'p1') return 'High';
  if (n.startsWith('med') || n === 'm' || n === 'p2') return 'Medium';
  if (n.startsWith('low') || n === 'l' || n === 'p3') return 'Low';
  return null;
}

// ---------- template example rows ----------
const APP_EXAMPLE: Record<AppKey, string> = {
  id: 'APP-001', name: 'Ravi Kumar', city: 'Mysuru', state: 'Karnataka', pin: '570001', investment: '25', experience: '4',
  business: 'Runs a footwear store', space: 'Rented', size: '450', floor: 'Ground', launch: '3', language: 'Kannada', notes: 'Wants to open before Diwali',
};
const TERR_EXAMPLE: Record<TerrKey, string> = {
  id: 'TER-01', city: 'Mysuru', state: 'Karnataka', pins: '570001, 570002, 570008', tier: 'Tier 2', slots: '3', priority: 'High',
};
function matchesExample(row: Row, map: Record<string, number>, example: Record<string, string>): boolean {
  const keys = Object.keys(map);
  if (keys.length < 3) return false;
  return keys.every((k) => norm(row[map[k]]) === norm(example[k]));
}

const rowIsBlank = (row: Row | undefined) => !row || row.every(isBlank);

// ---------- notes regex ----------
export const NOTE_PATTERNS = {
  stillSearching: /(still|currently)\s+(searching|looking)|looking for (a |the )?(space|shop|site|location)|searching for (a |the )?(space|shop|site)|broker showing|yet to (find|finali[sz]e)/i,
  upperFloor: /\b(first|1st|second|2nd|upper|top)\s+floor\b|upstairs|stairs from/i,
};

// ---------- main ----------
export function parseWorkbook(data: ArrayBuffer, fileName: string): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch {
    throw new Error(`"${fileName}" could not be read as an Excel or CSV file. Please upload the .xlsx template.`);
  }
  if (!wb.SheetNames.length) throw new Error(`"${fileName}" has no sheets.`);
  const warnings: string[] = [];
  const used = new Set<string>();

  const appsSheet = pickSheet(wb, 'apps', used);
  if (!appsSheet)
    throw new Error(
      `No Applications sheet found in "${fileName}". The file needs a sheet with the columns Application ID, Applicant name, City, Pin code, Investment capacity (₹ lakh) and so on, as in the template.`,
    );
  used.add(appsSheet.name);
  if (!SHEET_NAME.apps(norm(appsSheet.name))) warnings.push(`No sheet called "Applications"; used "${appsSheet.name}" because its columns match.`);

  const terrSheet = pickSheet(wb, 'terr', used);
  if (terrSheet) used.add(terrSheet.name);
  else warnings.push('No Territories sheet found: every applicant will be waitlisted as "no territory yet".');

  const storeSheet = pickSheet(wb, 'stores', used);

  // ---- applications ----
  let exampleRowDropped = false;
  let blankRowsSkipped = 0;
  const applications: Application[] = [];
  {
    const { rows, header } = appsSheet;
    const map = header.map as Record<AppKey, number>;
    const get = (row: Row, k: AppKey) => (map[k] === undefined ? null : row[map[k]]);
    let firstData = true;
    const seen = new Map<string, number>();
    // trailing blank rows are not "skipped rows"
    let last = rows.length - 1;
    while (last > header.index && rowIsBlank(rows[last])) last--;
    for (let i = header.index + 1; i <= last; i++) {
      const row = rows[i] ?? [];
      const rowNumber = i + 1;
      if (rowIsBlank(row)) {
        blankRowsSkipped++;
        continue;
      }
      if (firstData) {
        firstData = false;
        if (matchesExample(row, map, APP_EXAMPLE)) {
          exampleRowDropped = true;
          continue;
        }
      }
      applications.push(parseApplication(row, rowNumber, get, seen));
    }
    // later duplicates get a unique uid
    if (exampleRowDropped) warnings.push(`Row ${header.index + 2} is the untouched template example (APP-001 Ravi Kumar) and was ignored.`);
  }
  if (blankRowsSkipped) warnings.push(`${blankRowsSkipped} blank row${blankRowsSkipped > 1 ? 's were' : ' was'} skipped in Applications.`);
  if (!applications.length) warnings.push(`The "${appsSheet.name}" sheet has headers but no applicant rows${exampleRowDropped ? ' (only the template example, which is ignored)' : ''}. Add applicants from the row under the headers.`);
  const dups = applications.filter((a) => a.flags.some((f) => f.code === 'DUPLICATE_ID'));
  if (dups.length) warnings.push(`Duplicate Application IDs kept as separate applicants: ${dups.map((d) => `${d.id} (row ${d.rowNumber})`).join(', ')}.`);

  // ---- territories ----
  const territories: Territory[] = [];
  if (terrSheet) {
    const { rows, header } = terrSheet;
    const map = header.map as Record<TerrKey, number>;
    const get = (row: Row, k: TerrKey) => (map[k] === undefined ? null : row[map[k]]);
    let firstData = true;
    const seen = new Set<string>();
    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (rowIsBlank(row)) continue;
      if (firstData) {
        firstData = false;
        if (matchesExample(row, map, TERR_EXAMPLE)) {
          warnings.push(`Territories row ${i + 1} is the untouched template example (TER-01 Mysuru) and was ignored.`);
          continue;
        }
      }
      const t = parseTerritory(row, i + 1, get);
      if (seen.has(t.id)) {
        t.flags.push({ code: 'DUPLICATE_TERRITORY_ID', severity: 'info', message: `Territory ID ${t.id} appears twice; this one (row ${t.rowNumber}) is kept as ${t.id}#row${t.rowNumber}.` });
        t.id = `${t.id}#row${t.rowNumber}`;
      }
      seen.add(t.id);
      territories.push(t);
    }
  }

  if (terrSheet && !territories.length) warnings.push(`The "${terrSheet.name}" sheet has no territory rows: every applicant will be waitlisted as "no territory yet".`);

  // ---- existing stores ----
  let stores: ExistingStore[] = [];
  let storesFromFile = false;
  if (storeSheet) {
    const { rows, header } = storeSheet;
    const map = header.map as Record<StoreKey, number>;
    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (rowIsBlank(row)) continue;
      const pin = parsePin(row[map.pin]);
      const id = text(row[map.id]);
      if (!pin || !id) continue;
      const city = matchCity(map.city === undefined ? null : row[map.city]) ?? cityFromPin(pin) ?? 'Bengaluru';
      const opened = map.opened === undefined ? 0 : (parseNumberCell(row[map.opened]).value ?? 0);
      stores.push({ id, city, pin, opened });
    }
    if (stores.length) storesFromFile = true;
  }
  if (!stores.length) {
    stores = EXISTING_STORES.map((s) => ({ ...s }));
    warnings.push('No Existing stores sheet found: used the fixed list of 10 stores (ST-01 to ST-10).');
  }

  return {
    applications,
    territories,
    stores,
    warnings,
    source: { fileName, sheetNames: wb.SheetNames.slice(), exampleRowDropped, blankRowsSkipped, storesFromFile },
  };
}

function parseApplication(row: Row, rowNumber: number, get: (row: Row, k: AppKey) => unknown, seen: Map<string, number>): Application {
  const flags: DataFlag[] = [];
  const flag = (code: string, severity: DataFlag['severity'], message: string, field?: keyof Application) => flags.push({ code, severity, message, field });

  let id = text(get(row, 'id')).toUpperCase();
  if (!id) {
    id = `ROW-${rowNumber}`;
    flag('ID_MISSING', 'info', `No Application ID on row ${rowNumber}; using ${id}.`, 'id');
  }
  let uid = id;
  if (seen.has(id)) {
    uid = `${id}#row${rowNumber}`;
    flag('DUPLICATE_ID', 'ask', `Application ID ${id} is also used on row ${seen.get(id)}. Kept as a separate applicant (${uid}); confirm the correct ID.`, 'id');
  } else seen.set(id, rowNumber);

  const name = text(get(row, 'name'));
  if (!name) flag('NAME_MISSING', 'ask', 'Applicant name is blank.', 'name');

  // city + pin
  const cityRaw = text(get(row, 'city'));
  const cityMatch = matchCity(cityRaw);
  const pinRaw = text(get(row, 'pin'));
  const pin = parsePin(get(row, 'pin'));
  const pinCity = pin ? cityFromPin(pin) : null;
  let city: City | string = cityMatch ?? cityRaw;
  if (cityMatch && norm(cityRaw) !== norm(cityMatch)) flag('CITY_NORMALISED', 'info', `City "${cityRaw}" read as ${cityMatch}.`, 'city');
  if (!pin) {
    flag('PIN_INVALID', 'block', pinRaw ? `Pin code "${pinRaw}" is not a 6-digit pin.` : 'Pin code is blank.', 'pin');
  } else if (typeof get(row, 'pin') === 'string' && pinRaw !== pin) {
    flag('PIN_CLEANED', 'info', `Pin "${pinRaw}" read as ${pin}.`, 'pin');
  }
  if (!cityMatch) {
    if (pinCity) {
      flag('CITY_UNKNOWN', 'block', `City "${cityRaw || '(blank)'}" is not one of the 7 cities. The pin ${pin} belongs to ${pinCity}.`, 'city');
    } else flag('CITY_UNKNOWN', 'block', `City "${cityRaw || '(blank)'}" is not one of the 7 cities we expand in.`, 'city');
  } else if (pin) {
    if (!pinCity) flag('PIN_NOT_IN_CITY', 'block', `Pin ${pin} is not in any of our 7 cities; ${cityMatch} pins start with ${CITY_PIN_PREFIX[cityMatch]}.`, 'pin');
    else if (pinCity !== cityMatch)
      flag('PIN_NOT_IN_CITY', 'block', `Pin ${pin} is in ${pinCity}, but the form says ${cityMatch}.`, 'pin');
  }
  city = cityMatch ?? (cityRaw || '');

  const state = text(get(row, 'state'));
  if (state && norm(state) !== 'karnataka') flag('STATE_MISMATCH', 'info', `State "${state}" read as Karnataka.`, 'state');

  // investment
  const invRaw = get(row, 'investment');
  const inv = parseLakh(invRaw);
  if (inv.value === null) flag('INVESTMENT_MISSING', 'block', isBlank(invRaw) ? 'Investment capacity is blank.' : `Investment "${text(invRaw)}" could not be read.`, 'investmentLakh');
  else if (inv.fromText) flag('INVESTMENT_PARSED_FROM_TEXT', 'info', `Investment "${text(invRaw)}" read as ₹${inv.value} lakh.`, 'investmentLakh');
  if (inv.value !== null && inv.value <= 0) flag('INVESTMENT_ZERO', 'info', 'Investment capacity is 0.', 'investmentLakh');

  // experience
  const expRaw = get(row, 'experience');
  const exp = parseNumberCell(expRaw);
  const experienceYears = exp.value === null ? null : Math.max(0, exp.value);
  if (experienceYears === null) {
    flag('EXPERIENCE_MISSING', 'block', isBlank(expRaw) ? 'Retail experience is blank (the template asks for 0 if none).' : `Retail experience "${text(expRaw)}" could not be read.`, 'experienceYears');
  } else if (exp.fromText) flag('EXPERIENCE_PARSED_FROM_TEXT', 'info', `Experience "${text(expRaw)}" read as ${experienceYears} years.`, 'experienceYears');

  const currentBusiness = text(get(row, 'business'));
  const notes = text(get(row, 'notes'));

  // space
  const spaceRaw = get(row, 'space');
  const spaceAvailable = parseSpace(spaceRaw);
  if (!spaceAvailable)
    flag('SPACE_MISSING', 'ask', isBlank(spaceRaw) ? 'Space available is blank (Owned / Rented / Not yet identified).' : `Space "${text(spaceRaw)}" is not Owned, Rented or Not yet identified.`, 'spaceAvailable');
  const sizeRaw = get(row, 'size');
  const size = parseNumberCell(sizeRaw);
  const spaceSizeSqft = size.value !== null && size.value > 0 ? Math.round(size.value) : null;
  if (size.fromText && spaceSizeSqft !== null) flag('SIZE_PARSED_FROM_TEXT', 'info', `Space size "${text(sizeRaw)}" read as ${spaceSizeSqft} sq ft.`, 'spaceSizeSqft');
  if ((spaceAvailable === 'Owned' || spaceAvailable === 'Rented') && spaceSizeSqft === null)
    flag('SPACE_SIZE_MISSING', 'ask', `Space is ${spaceAvailable} but the size is blank.`, 'spaceSizeSqft');
  if (spaceAvailable === 'Not yet identified' && spaceSizeSqft !== null)
    flag('SPACE_SIZE_WITHOUT_SPACE', 'ask', `Space is "Not yet identified" but a size of ${spaceSizeSqft} sq ft is given.`, 'spaceSizeSqft');
  if ((spaceAvailable === 'Owned' || spaceAvailable === 'Rented') && NOTE_PATTERNS.stillSearching.test(notes))
    flag('NOTES_CONTRADICT_SPACE', 'ask', `Space is ${spaceAvailable}, but the notes say "${notes}".`, 'spaceAvailable');

  // floor
  const floorRaw = get(row, 'floor');
  let floor = parseFloor(floorRaw);
  if (!floor) {
    if (!isBlank(floorRaw)) flag('FLOOR_INVALID', 'info', `Floor "${text(floorRaw)}" not recognised; read as Not known.`, 'floor');
    else flag('FLOOR_MISSING', 'info', 'Floor is blank; read as Not known.', 'floor');
    floor = 'Not known';
  }
  if (floor === 'Ground' && NOTE_PATTERNS.upperFloor.test(notes))
    flag('NOTES_CONTRADICT_FLOOR', 'ask', `Floor says Ground, but the notes say "${notes}".`, 'floor');

  // launch
  const launchRaw = get(row, 'launch');
  const launch = parseNumberCell(launchRaw);
  let targetLaunchMonths = launch.value !== null && launch.value > 0 ? launch.value : null;
  if (targetLaunchMonths === null) {
    flag('LAUNCH_MISSING', 'ask', isBlank(launchRaw) ? 'Target launch is blank; planning assumes 6 months.' : `Target launch "${text(launchRaw)}" could not be read; planning assumes 6 months.`, 'targetLaunchMonths');
  } else if (launch.fromText) flag('LAUNCH_PARSED_FROM_TEXT', 'info', `Target launch "${text(launchRaw)}" read as ${targetLaunchMonths} months.`, 'targetLaunchMonths');
  if (targetLaunchMonths !== null) targetLaunchMonths = Math.round(targetLaunchMonths * 10) / 10;

  // language
  const languageRaw = text(get(row, 'language'));
  const lang = parseLanguage(languageRaw);
  if (!languageRaw) flag('LANGUAGE_MISSING', 'ask', 'Preferred language is blank; training defaults to English.', 'preferredLanguage');
  else if (!lang.value) flag('LANGUAGE_NOT_SUPPORTED', 'ask', `Language "${languageRaw}" is not offered (Kannada, English, Hindi); training defaults to English.`, 'preferredLanguage');
  else if (lang.all.length > 1) flag('LANGUAGE_MULTIPLE', 'info', `Two languages given ("${languageRaw}"); training planned in ${lang.value}.`, 'preferredLanguage');

  return {
    uid,
    rowNumber,
    id,
    name: name || `(no name, row ${rowNumber})`,
    city,
    state: state || 'Karnataka',
    pin,
    pinRaw,
    investmentLakh: inv.value,
    experienceYears,
    currentBusiness,
    spaceAvailable,
    spaceSizeSqft,
    floor,
    targetLaunchMonths,
    preferredLanguage: lang.value,
    languageRaw,
    notes,
    flags,
  };
}

function parseTerritory(row: Row, rowNumber: number, get: (row: Row, k: TerrKey) => unknown): Territory {
  const flags: DataFlag[] = [];
  const id = text(get(row, 'id')).toUpperCase() || `TER-ROW${rowNumber}`;
  const cityRaw = text(get(row, 'city'));
  const pinsRaw = get(row, 'pins');
  const pins: string[] = [];
  const bad: string[] = [];
  const parts = typeof pinsRaw === 'number' ? [String(pinsRaw)] : text(pinsRaw).split(/[,;/|\n]+/);
  for (const p of parts) {
    if (!p.trim()) continue;
    // "560037 560103" without commas
    const chunks = p.trim().replace(/\s{2,}/g, ' ').match(/\d[\d\s]*\d/g) ?? [p];
    for (const c of chunks) {
      const digits = c.replace(/\D/g, '');
      if (digits.length === 6) {
        if (!pins.includes(digits)) pins.push(digits);
      } else if (digits.length > 6 && digits.length % 6 === 0) {
        for (let i = 0; i < digits.length; i += 6) if (!pins.includes(digits.slice(i, i + 6))) pins.push(digits.slice(i, i + 6));
      } else bad.push(c.trim());
    }
  }
  if (bad.length) flags.push({ code: 'TERRITORY_PIN_INVALID', severity: 'info', message: `Ignored unreadable pins: ${bad.join(', ')}.` });
  if (!pins.length) flags.push({ code: 'TERRITORY_NO_PINS', severity: 'ask', message: 'No valid pin codes listed; no applicant can match this territory.' });

  let city: City | string = matchCity(cityRaw) ?? '';
  if (!city) {
    const fromPin = pins.length ? cityFromPin(pins[0]) : null;
    city = fromPin ?? cityRaw;
    flags.push({ code: 'TERRITORY_CITY_UNKNOWN', severity: 'info', message: fromPin ? `City "${cityRaw || '(blank)'}" read as ${fromPin} from its pins.` : `City "${cityRaw}" not recognised.` });
  }
  const foreign = pins.filter((p) => cityFromPin(p) !== city);
  if (foreign.length && CITY_TIER[city as City])
    flags.push({ code: 'TERRITORY_PIN_OTHER_CITY', severity: 'info', message: `Pins ${foreign.join(', ')} are not ${city} pins.` });

  let tier = parseTier(get(row, 'tier'));
  const cityTier = CITY_TIER[city as City];
  if (!tier) {
    tier = cityTier ?? 'Tier 2';
    flags.push({ code: 'TERRITORY_TIER_DEFAULT', severity: 'info', message: `City tier blank or unreadable; using ${tier}${cityTier ? ` (from ${city})` : ''}.` });
  } else if (cityTier && tier !== cityTier) {
    flags.push({ code: 'TERRITORY_TIER_MISMATCH', severity: 'info', message: `Tier given as ${tier}, but ${city} is ${cityTier}; store economics use ${cityTier}.` });
  }
  const slotsRaw = get(row, 'slots');
  const slots = parseNumberCell(slotsRaw).value;
  let openSlots = 0;
  if (slots === null) flags.push({ code: 'TERRITORY_SLOTS_DEFAULT', severity: 'ask', message: 'Open slots blank or unreadable; treated as 0 (no new store).' });
  else openSlots = Math.max(0, Math.floor(slots));
  let priority = parsePriority(get(row, 'priority'));
  if (!priority) {
    priority = 'Medium';
    flags.push({ code: 'TERRITORY_PRIORITY_DEFAULT', severity: 'info', message: 'Priority blank or unreadable; treated as Medium.' });
  }
  return { id, city, state: text(get(row, 'state')) || 'Karnataka', pins, tier, openSlots, priority, rowNumber, flags };
}
