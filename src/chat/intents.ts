// Plain-language question → structured intent. Pure, regex-first, no LLM.
// The engine makes every decision; this file only works out what the user is asking for.
import type { Application, City, DataFlag, Decision, Floor, Language, SpaceAvailable } from '../types';
import { CITY_PIN_PREFIX } from '../config/rules';

export interface ListFilter {
  decisions?: Decision[];
  city?: City;
  territoryId?: string;
  flagged?: boolean;
}

export interface UpdateIntent {
  kind: 'update';
  appId: string;
  /** Absolute field values read from the text. */
  patch: Partial<Application>;
  /** Amount to add to the current investment (loan, co-investor money). */
  investmentDeltaLakh?: number;
  /** Sentences to append to the notes (the engine's regex reads notes for manager / co-investor). */
  notesAppend: string[];
  assumptions: string[];
  withdraw?: boolean;
}

export type Intent =
  | { kind: 'explain'; appId: string; premise?: Decision[] }
  | UpdateIntent
  | { kind: 'list'; filter: ListFilter }
  | { kind: 'compare'; a: string; b: string }
  | { kind: 'territory'; terId: string }
  | { kind: 'gaps'; city?: City }
  | { kind: 'ambiguous'; query: string; candidates: string[] }
  | { kind: 'unknownId'; appId: string }
  | { kind: 'help' }
  | { kind: 'unknown'; text: string };

export interface NameRef {
  id: string;
  name: string;
}

// ---------------------------------------------------------------- IDs

/** 'APP-7', 'app 007', 'APP007', 'app#12' → 'APP-007'. */
export function normaliseAppId(raw: string): string | null {
  const m = /^\s*app[\s\-_#.]*0*(\d{1,5})\s*$/i.exec(raw);
  if (!m) return null;
  return `APP-${m[1].padStart(3, '0')}`;
}

/** 'TER 2', 'ter-02', 'TER02' → 'TER-02'. */
export function normaliseTerId(raw: string): string | null {
  const m = /^\s*ter[\s\-_#.]*0*(\d{1,3})\s*$/i.exec(raw);
  if (!m) return null;
  return `TER-${m[1].padStart(2, '0')}`;
}

const APP_RE = /\bapp(?:lication)?[\s\-_#.]*(?:id[\s:]*)?0*(\d{1,5})\b/gi;
const TER_RE = /\bter(?:ritory)?[\s\-_#.]*0*(\d{1,3})\b/gi;

function matchKnown(canonical: string, known: string[]): string {
  // Known IDs may be typed differently in the file (e.g. 'APP-0007'); match on the normalised form.
  const hit = known.find((k) => k.toUpperCase() === canonical || normaliseAppId(k) === canonical);
  return hit ?? canonical;
}

export function extractAppIds(text: string, known: string[] = []): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(APP_RE)) {
    const id = matchKnown(`APP-${m[1].padStart(3, '0')}`, known);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function extractTerId(text: string): string | null {
  for (const m of text.matchAll(TER_RE)) return `TER-${m[1].padStart(2, '0')}`;
  return null;
}

// ---------------------------------------------------------------- vocab

const CITY_ALIASES: [RegExp, City][] = [
  [/\b(bengaluru|bangalore|blr|bengalooru)\b/i, 'Bengaluru'],
  [/\b(mysuru|mysore)\b/i, 'Mysuru'],
  [/\b(mangaluru|mangalore)\b/i, 'Mangaluru'],
  [/\b(hubballi|hubli|dharwad|hubballi-dharwad)\b/i, 'Hubballi-Dharwad'],
  [/\b(belagavi|belgaum)\b/i, 'Belagavi'],
  [/\b(tumakuru|tumkur)\b/i, 'Tumakuru'],
  [/\b(davanagere|davangere)\b/i, 'Davanagere'],
];

export function extractCity(text: string): City | undefined {
  for (const [re, c] of CITY_ALIASES) if (re.test(text)) return c;
  return undefined;
}

/** Decision words → decisions. 'approved' covers both approval states. */
export function extractDecisions(text: string): Decision[] | undefined {
  const t = text.toLowerCase();
  if (/with conditions|conditional|\bconditions?\b/.test(t)) return ['Approve with conditions'];
  if (/wait-?\s?list/.test(t)) return ['Waitlist'];
  if (/redirect/.test(t)) return ['Redirect'];
  if (/declin|reject|turned down|refus/.test(t)) return ['Decline'];
  if (/\bon hold\b|\bhold\b|\bheld\b|\bholds\b/.test(t)) return ['Hold'];
  if (/approv|\bfund(ed|ing)?\b|green.?lit|accepted|\bwinners?\b/.test(t)) return ['Approve', 'Approve with conditions'];
  return undefined;
}

const STOPWORDS = new Set(
  'a an the is are was were why what who whom how about tell me explain show give status of on in to for and or with did does do has have had not this that it its his her their him them she he they we us our you your please can could would should will now new store stores space shop applicant application decision hold waitlist redirect decline approve approved held happened happen open next where which list all any info information update'.split(
    ' ',
  ),
);

// ---------------------------------------------------------------- numbers

/** Money in lakh: '40 lakh', '45L', '₹25 L', '1.2 crore'. */
function moneyIn(fragment: string): number | null {
  const cr = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:crores?|cr)\b/i.exec(fragment);
  if (cr) return Math.round(parseFloat(cr[1]) * 100 * 10) / 10;
  const l = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|lakh|l)\b/i.exec(fragment);
  if (l) return parseFloat(l[1]);
  return null;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, a: 1 };
const num = (s: string) => (s in WORD_NUM ? WORD_NUM[s] : parseFloat(s));
const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';

// ---------------------------------------------------------------- update parsing

const UPDATE_CUE =
  /\b(found|finds|got|gets|has now|now has|bought|purchased|owns?|owned|rent(ed|s)?|leas(e|ed)|signed|secured|identified|finali[sz]ed|locked|hired|appointed|co-?investor|partner|investment|invest|capital|budget|loan|sq\.?\s*ft|sqft|square\s*feet|ground|upper|first[\s-]floor|mall|experience|moved|relocat\w*|shift\w*|new pin|pin code|pincode|withdr\w*|pulled out|backed out|prefers?|language|speaks?|wants to open|open in|launch\w*|lost)\b/i;

/**
 * Read new information about one applicant. Returns null when nothing usable was found.
 * Every guess is listed in `assumptions` so the user sees exactly what the engine was told.
 */
export function parseUpdate(text: string, appId: string): UpdateIntent | null {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  const patch: Partial<Application> = {};
  const notesAppend: string[] = [];
  const assumptions: string[] = [];
  let investmentDeltaLakh: number | undefined;

  if (/\bwithdr[ae]wn?\b|\bwithdrawing\b|pulled out|backed out|no longer interested|dropp(ed|ing) out/.test(t)) {
    return { kind: 'update', appId, patch: {}, notesAppend: [], assumptions: [], withdraw: true };
  }

  // Manager clause is read first and removed, so its years are not taken as the applicant's experience.
  let rest = t;
  const mgr = /\b(hired|appointed|found|got|recruited|signed up|onboarded|has)\s+(a|an|the)?\s*(experienced\s+)?(store\s+|shop\s+|retail\s+)?manager\b(?:[^.;]|\.\d)*/.exec(t) ??
    /\bmanager\s+(is\s+|has been\s+)?(hired|appointed|on board|onboarded|joined)\b(?:[^.;]|\.\d)*/.exec(t);
  if (mgr) {
    const y = new RegExp(`${NUM}\\s*(?:\\+\\s*)?(?:years?|yrs?)`).exec(mgr[0]);
    notesAppend.push(`Hired a store manager${y ? ` with ${num(y[1])} years retail experience` : ''} (chat update).`);
    rest = t.replace(mgr[0], ' ');
  }

  // Co-investor / extra money
  const coInv = /\bco-?\s?investor\b|\bbusiness partner\b|\bpartner (has )?(joined|invest)/.test(rest);
  const loan = /\b(loan|co-?\s?investor|partner|additional|extra|another|more)\b(?:[^.;]|\.\d)*/.exec(rest);
  if (coInv) notesAppend.push('Co-investor confirmed (chat update).');
  if (loan) {
    const amt = moneyIn(loan[0]);
    if (amt !== null && /\b(loan|additional|extra|another|more|adds?|brings?|putting|puts|contribut)/.test(loan[0])) {
      investmentDeltaLakh = amt;
      if (/\bloan\b/.test(loan[0])) notesAppend.push(`Loan of ₹${amt}L sanctioned (chat update).`);
      rest = rest.replace(loan[0], ' ');
    }
  }
  if (investmentDeltaLakh === undefined) {
    const inv = /\b(investment|invest|capital|budget|funds?|capacity)\b(?:[^.;]|\.\d)*/.exec(rest);
    if (inv) {
      const amt = moneyIn(inv[0]);
      if (amt !== null) patch.investmentLakh = amt;
    }
  }

  // Space
  let space: SpaceAvailable | null = null;
  if (/\blost (the|their|his|her) (space|shop|site)|space fell through|deal fell through|no longer has (a |the )?(space|shop)|(space|shop) (is )?(gone|cancelled)/.test(rest)) {
    space = 'Not yet identified';
  } else if (/\b(bought|purchased|owns?|owned|own building|own premises|own shop|inherited)\b/.test(rest)) {
    space = 'Owned';
  } else if (/\b(rent(ed|s|ing)?|leas(e|ed|ing)|signed (a |the )?(lease|rent))/.test(rest)) {
    space = 'Rented';
  } else if (/\b(found|finds|got|gets|has now|now has|secured|identified|finali[sz]ed|locked|located|shortlisted)\b(?:[^.;]|\.\d)*\b(space|shop|site|premises|unit|outlet|property|location|showroom|place)\b/.test(rest)) {
    space = 'Rented';
    assumptions.push('Assumed rented (the message did not say owned).');
  }
  if (space) patch.spaceAvailable = space;

  const size = /(\d[\d,]*)\s*(?:sq\.?\s*ft\.?|sqft|sft|sq\.?\s*feet|square\s*f(ee|oo)t)/.exec(rest);
  if (size) {
    const v = parseInt(size[1].replace(/,/g, ''), 10);
    if (v > 0) {
      patch.spaceSizeSqft = v;
    }
  }

  let floor: Floor | null = null;
  if (/\bmall\b/.test(rest)) floor = 'Mall unit';
  else if (/ground[\s-]*floor|\bground\b|street[\s-]facing|street level/.test(rest)) floor = 'Ground';
  else if (/(first|1st|second|2nd|third|3rd|upper|top)[\s-]*floor|\bupstairs\b|mezzanine/.test(rest)) floor = 'Upper';
  if (floor) {
    patch.floor = floor;
    if (!space && /\b(found|got|has|secured|identified|space|shop|site|unit)\b/.test(rest) && !patch.spaceAvailable) {
      patch.spaceAvailable = 'Rented';
      if (!assumptions.length) assumptions.push('Assumed rented (the message did not say owned).');
    }
  }

  // Experience (applicant's own)
  const exp =
    new RegExp(`${NUM}\\s*\\+?\\s*(?:years?|yrs?)\\s*(?:of\\s*)?(?:retail\\s*|store\\s*|shop\\s*)?(?:experience|exp\\b)`).exec(rest) ??
    new RegExp(`experience\\s*(?:is|of|now|=|:)?\\s*(?:now\\s*)?${NUM}`).exec(rest) ??
    new RegExp(`(?:has|have|with)\\s+${NUM}\\s*(?:years?|yrs?)\\s+(?:in|running|of running)\\s+(?:retail|a shop|a store)`).exec(rest);
  if (exp) patch.experienceYears = num(exp[1]);
  else if (/\bno (retail )?experience\b|\bzero experience\b/.test(rest)) patch.experienceYears = 0;

  // Launch timeline
  const launch =
    new RegExp(`(?:open|launch|start|go live|opening)\\w*\\s+(?:the store\\s+)?(?:in|within)\\s+${NUM}\\s*(months?|weeks?)`).exec(rest) ??
    new RegExp(`(?:target|timeline|launch)\\w*\\s+(?:is\\s+|of\\s+)?(?:now\\s+)?${NUM}\\s*(months?|weeks?)`).exec(rest);
  if (launch) {
    const n = num(launch[1]);
    patch.targetLaunchMonths = /week/.test(launch[2]) ? Math.max(1, Math.ceil(n / 4.33)) : n;
    if (/week/.test(launch[2])) assumptions.push(`${n} weeks rounded up to ${patch.targetLaunchMonths} month(s).`);
  } else if (/(open|launch)\w*\s+next month/.test(rest)) {
    patch.targetLaunchMonths = 1;
  }

  // Language
  const lang = /\b(kannada|english|hindi)\b/.exec(rest);
  if (lang && /prefer|language|speak|training in|talk in|in (kannada|english|hindi)|comfortable/.test(rest)) {
    patch.preferredLanguage = (lang[1][0].toUpperCase() + lang[1].slice(1)) as Language;
  }

  // Pin move
  const pinM = /\b(5\d{2})\s?(\d{3})\b/.exec(rest);
  if (pinM && /moved|move|shift|relocat|new pin|pin\s*(code)?\s*(is|now|changed|to)|pincode|changed|instead|switch|to\s+5\d{2}/.test(rest)) {
    const pin = pinM[1] + pinM[2];
    patch.pin = pin;
    const city = (Object.keys(CITY_PIN_PREFIX) as City[]).find((c) => CITY_PIN_PREFIX[c] === pinM[1]);
    if (city) {
      patch.city = city;
    } else {
      assumptions.push(`Pin ${pin} is outside the 7 cities we cover; city left unchanged.`);
    }
  }

  const hasData = Object.keys(patch).length > 0 || notesAppend.length > 0 || investmentDeltaLakh !== undefined;
  if (!hasData) return null;
  return { kind: 'update', appId, patch, investmentDeltaLakh, notesAppend, assumptions };
}

// ---------------------------------------------------------------- resolve against the current record

export interface FieldChange {
  field: keyof Application;
  label: string;
  from: string;
  to: string;
}

export interface ResolvedUpdate {
  patch: Partial<Application>;
  changes: FieldChange[];
  assumptions: string[];
}

const FIELD_LABEL: Partial<Record<keyof Application, string>> = {
  spaceAvailable: 'Space',
  spaceSizeSqft: 'Space size',
  floor: 'Floor',
  investmentLakh: 'Investment capacity',
  experienceYears: 'Retail experience',
  targetLaunchMonths: 'Target launch',
  preferredLanguage: 'Language',
  pin: 'Pin code',
  city: 'City',
  notes: 'Notes',
};

function show(field: keyof Application, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (field === 'investmentLakh') return `₹${v}L`;
  if (field === 'spaceSizeSqft') return `${v} sq ft`;
  if (field === 'experienceYears') return `${v} yrs`;
  if (field === 'targetLaunchMonths') return `${v} months`;
  return String(v);
}

/** Fields that, once changed, make the parser's earlier flags on them stale. */
const FLAG_GROUPS: Partial<Record<keyof Application, { fields: (keyof Application)[]; codes: RegExp }>> = {
  spaceAvailable: { fields: ['spaceAvailable', 'spaceSizeSqft', 'floor'], codes: /SPACE|FLOOR|SIZE/ },
  spaceSizeSqft: { fields: ['spaceAvailable', 'spaceSizeSqft'], codes: /SPACE|SIZE/ },
  floor: { fields: ['floor'], codes: /FLOOR/ },
  investmentLakh: { fields: ['investmentLakh'], codes: /INVEST/ },
  experienceYears: { fields: ['experienceYears'], codes: /EXPER/ },
  targetLaunchMonths: { fields: ['targetLaunchMonths'], codes: /LAUNCH|TIMELINE/ },
  preferredLanguage: { fields: ['preferredLanguage', 'languageRaw'], codes: /LANG/ },
  pin: { fields: ['pin', 'pinRaw', 'city'], codes: /PIN|CITY/ },
  city: { fields: ['pin', 'pinRaw', 'city'], codes: /PIN|CITY/ },
};

export function staleFlagFilter(flags: DataFlag[], changed: (keyof Application)[]): DataFlag[] {
  const fields = new Set<keyof Application>();
  const codes: RegExp[] = [];
  for (const c of changed) {
    const g = FLAG_GROUPS[c];
    if (!g) continue;
    g.fields.forEach((f) => fields.add(f));
    codes.push(g.codes);
  }
  return flags.filter((f) => !(f.field && fields.has(f.field)) && !codes.some((re) => re.test(f.code)));
}

/** Turn an update intent into a concrete patch for this applicant (adds loans, appends notes, drops no-op fields). */
export function resolveUpdate(intent: UpdateIntent, app: Application): ResolvedUpdate {
  const patch: Partial<Application> = { ...intent.patch };
  const assumptions = [...intent.assumptions];

  if (intent.investmentDeltaLakh !== undefined) {
    const base = patch.investmentLakh ?? app.investmentLakh ?? 0;
    patch.investmentLakh = Math.round((base + intent.investmentDeltaLakh) * 10) / 10;
    assumptions.push(`Added ₹${intent.investmentDeltaLakh}L to the current ${app.investmentLakh === null ? '₹0L (blank)' : `₹${base}L`} = ₹${patch.investmentLakh}L.`);
  }
  if (intent.notesAppend.length) {
    const fresh = intent.notesAppend.filter((n) => !app.notes.includes(n));
    if (fresh.length) patch.notes = [app.notes.trim(), ...fresh].filter(Boolean).join(' ');
  }
  if (patch.pin) patch.pinRaw = patch.pin;
  if (patch.preferredLanguage) patch.languageRaw = patch.preferredLanguage;

  if (patch.spaceAvailable && patch.spaceAvailable !== 'Not yet identified' && (patch.spaceSizeSqft ?? app.spaceSizeSqft) === null) {
    assumptions.push('Size not given; we will ask for it.');
  }
  if (patch.spaceAvailable === 'Not yet identified') {
    patch.spaceSizeSqft = null;
    patch.floor = 'Not known';
  }
  if (patch.spaceAvailable && patch.spaceAvailable !== 'Not yet identified' && !patch.floor && (!app.floor || app.floor === 'Not known')) {
    assumptions.push('Floor not given; we will ask for it.');
  }

  // Drop fields that did not actually change.
  for (const k of Object.keys(patch) as (keyof Application)[]) {
    if (patch[k] === app[k]) delete patch[k];
  }

  const changes: FieldChange[] = (Object.keys(patch) as (keyof Application)[])
    .filter((k) => FIELD_LABEL[k])
    .map((k) => ({
      field: k,
      label: FIELD_LABEL[k]!,
      from: k === 'notes' ? '' : show(k, app[k]),
      to: k === 'notes' ? intent.notesAppend.join(' ') : show(k, patch[k]),
    }));

  if (changes.length) {
    const flags = staleFlagFilter(app.flags, Object.keys(patch) as (keyof Application)[]);
    if (flags.length !== app.flags.length) patch.flags = flags;
  }
  return { patch, changes, assumptions };
}

// ---------------------------------------------------------------- top-level

function findByName(text: string, names: NameRef[]): { full?: string; partial: string[]; token?: string } {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const full = names.filter((n) => n.name.trim().length > 2 && t.includes(` ${n.name.toLowerCase().trim()} `));
  if (full.length === 1) return { full: full[0].id, partial: [] };
  if (full.length > 1) return { partial: full.map((f) => f.id), token: full[0].name };
  const tokens = t.split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !extractCity(w));
  for (const w of tokens) {
    const hits = names.filter((n) => n.name.toLowerCase().split(/\s+/).includes(w));
    if (hits.length) return { partial: hits.map((h) => h.id), token: w };
  }
  return { partial: [] };
}

/**
 * Main entry. `knownIds` are the application IDs in the current file; `names` enables lookup by applicant name.
 */
export function parseIntent(text: string, knownIds: string[], names: NameRef[] = []): Intent {
  const raw = text.trim();
  const t = raw.toLowerCase();
  if (!raw) return { kind: 'help' };

  const known = new Set(knownIds.map((k) => k.toUpperCase()));
  const ids = extractAppIds(raw, knownIds);
  const terId = extractTerId(raw);
  const city = extractCity(raw);
  const decisions = extractDecisions(raw);
  const isQuestion = /^\s*(why|explain|what|how|tell|show|is|was|did|does|can|who|which|list|compare)\b/.test(t) && !/^\s*what if\b/.test(t);

  if (/^\s*(help|hi|hello|hey|\?|what can you do|commands)\b/.test(t)) return { kind: 'help' };

  // Two applicants → compare
  if (ids.length >= 2) return { kind: 'compare', a: ids[0], b: ids[1] };

  // Resolve a single applicant reference (ID first, then full name).
  let appId = ids[0];
  let nameHit: ReturnType<typeof findByName> | null = null;
  if (!appId && names.length) {
    nameHit = findByName(raw, names);
    if (nameHit.full) appId = nameHit.full;
  }

  if (appId) {
    if (ids.length && known.size && !known.has(appId.toUpperCase())) return { kind: 'unknownId', appId };
    if (!/^\s*why\b/.test(t) && (!isQuestion || /^\s*what if\b/.test(t) || /\bhas now\b|\bnow has\b/.test(t)) && UPDATE_CUE.test(t)) {
      const u = parseUpdate(raw, appId);
      if (u) return u;
    }
    return { kind: 'explain', appId, premise: /^\s*(why|is|was|how come)\b/.test(t) ? decisions : undefined };
  }

  // Comparison by names: "compare ravi and priya"
  if (/\b(compare|vs\.?|versus)\b/.test(t) && names.length) {
    const parts = raw.split(/\b(?:and|vs\.?|versus|with)\b/i).map((p) => p.replace(/\bcompare\b/i, ''));
    if (parts.length >= 2) {
      const a = findByName(parts[0], names);
      const b = findByName(parts[1], names);
      const ia = a.full ?? (a.partial.length === 1 ? a.partial[0] : undefined);
      const ib = b.full ?? (b.partial.length === 1 ? b.partial[0] : undefined);
      if (ia && ib) return { kind: 'compare', a: ia, b: ib };
    }
  }

  // Gaps / where to open
  if (/where (should|can|do|could) we open|open next|next stores?|gaps?\b|white ?space|unserved|uncovered|demand (but|with) no|best (pins?|places?|locations?)|expand next|untapped/.test(t)) {
    return { kind: 'gaps', city };
  }

  const flagged = /data (issue|problem|error)s?|flagged|missing (info|data)|incomplete|contradict/.test(t);
  const listCue = /\b(who|which|list|show|how many|all|everyone|anyone|count)\b/.test(t);

  if (terId) {
    if (decisions || flagged || (listCue && /\b(applicants?|people|partners)\b/.test(t))) {
      return { kind: 'list', filter: { decisions, territoryId: terId, city, flagged: flagged || undefined } };
    }
    return { kind: 'territory', terId };
  }

  if (decisions || flagged || (listCue && city)) {
    return { kind: 'list', filter: { decisions, city, flagged: flagged || undefined } };
  }

  // Fallback: a first name or surname typed on its own ("tell me about Ravi")
  if (names.length) {
    nameHit = nameHit ?? findByName(raw, names);
    if (nameHit.partial.length === 1) {
      const id = nameHit.partial[0];
      if (UPDATE_CUE.test(t) && !isQuestion) {
        const u = parseUpdate(raw, id);
        if (u) return u;
      }
      return { kind: 'explain', appId: id, premise: /^\s*(why|is|was)\b/.test(t) ? decisions : undefined };
    }
    if (nameHit.partial.length > 1) return { kind: 'ambiguous', query: nameHit.token ?? raw, candidates: nameHit.partial };
  }

  if (/\b(how|what) (does|do) (it|this|the (engine|tool|rules?)) work|what can i ask|examples?\b/.test(t)) return { kind: 'help' };
  return { kind: 'unknown', text: raw };
}
