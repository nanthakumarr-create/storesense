// Structured replies built only from engine output (Result / TerritoryStatus / GapPin fields).
// Nothing here invents a number: if the engine did not produce it, the reply does not say it.
import type { Decision, DecisionChange, EngineOutput, ParseResult, Result } from '../types';
import type { Intent, ListFilter, ResolvedUpdate } from './intents';

export interface ApplicantRef {
  uid: string;
  appId: string;
  name: string;
  decision: Decision;
}

export interface ReplySection {
  title: string;
  bullets: string[];
  tone?: 'neutral' | 'warn' | 'good';
}

export interface MetricRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface UpdateDiff {
  appId: string;
  uid: string;
  name: string;
  understood: { label: string; from: string; to: string }[];
  assumptions: string[];
  before: { decision: Decision; headline: string };
  after: { decision: Decision; headline: string };
  decisionChanged: boolean;
  metrics: MetricRow[];
  ripple: (DecisionChange & { why: string })[];
}

export interface CompareTable {
  a: ApplicantRef;
  b: ApplicantRef;
  rows: { label: string; a: string; b: string; better: 'a' | 'b' | null }[];
}

export interface Reply {
  text: string;
  bullets: string[];
  sections?: ReplySection[];
  /** Applicant chips; the first one is the subject when `focus` is set. */
  cards?: ApplicantRef[];
  focus?: ApplicantRef & { headline: string; numbers: { label: string; value: string }[] };
  compare?: CompareTable;
  diff?: UpdateDiff;
  tone?: 'info' | 'warn' | 'error';
  followUps?: string[];
}

// ---------------------------------------------------------------- helpers

export const VERB: Record<Decision, string> = {
  Approve: 'approved',
  'Approve with conditions': 'approved with conditions',
  Redirect: 'redirected',
  Waitlist: 'waitlisted',
  Hold: 'on hold',
  Decline: 'declined',
};

const lakh = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `₹${v.toFixed(v < 10 ? 1 : 0)}L`);
const km = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} km`);
const mo = (v: number | null | undefined) => (v === null || v === undefined ? 'no payback (loss-making)' : `${v.toFixed(0)} months`);
const sc = (v: number) => `${Math.round(v)}/100`;

export const refOf = (r: Result): ApplicantRef => ({ uid: r.uid, appId: r.appId, name: r.name, decision: r.decision });

/** Find a result by application ID; duplicates return every row so the reply can say so. */
export function findByAppId(output: EngineOutput, appId: string): Result[] {
  const id = appId.toUpperCase();
  return output.results.filter((r) => r.appId.toUpperCase() === id || r.uid.toUpperCase() === id);
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** IDs that look like the one typed: nearest numbers first, then nearest spelling. */
export function closeIds(output: EngineOutput, appId: string, n = 5): string[] {
  const target = parseInt(appId.replace(/\D/g, ''), 10);
  const ids = [...new Set(output.results.map((r) => r.appId))];
  return ids
    .map((id) => {
      const k = parseInt(id.replace(/\D/g, ''), 10);
      return { id, d: Number.isNaN(k) || Number.isNaN(target) ? 1e6 : Math.abs(k - target), l: levenshtein(id.toUpperCase(), appId.toUpperCase()) };
    })
    .sort((x, y) => x.l - y.l || x.d - y.d)
    .slice(0, n)
    .map((x) => x.id);
}

export function keyNumbers(r: Result): { label: string; value: string }[] {
  const out = [
    { label: 'Partner score', value: sc(r.partnerScore) },
    { label: 'Place score', value: sc(r.place.placeScore) },
    { label: 'Payback', value: r.economics.paybackMonths === null ? 'none' : `${r.economics.paybackMonths.toFixed(0)} mo` },
    { label: 'Cash gap', value: r.economics.capitalGapLakh > 0 ? `${lakh(r.economics.capitalGapLakh)} (${Math.round(r.economics.capitalGapPct * 100)}%)` : 'none' },
    { label: 'Nearest store', value: r.place.nearestStore ? `${km(r.place.nearestStore.km)} (${r.place.nearestStore.id})` : '—' },
    { label: 'Territory', value: r.territoryId ? `${r.territoryId}${r.rankInTerritory ? ` · rank ${r.rankInTerritory}` : ''}` : 'none' },
  ];
  return out;
}

const noData = (): Reply => ({
  text: 'There are no decisions to talk about yet. Upload an Applications + Territories file (or load the sample) first.',
  bullets: [],
  tone: 'warn',
});

// ---------------------------------------------------------------- explain

export function explainReply(r: Result, premise?: Decision[], duplicates: Result[] = []): Reply {
  const premiseWrong = premise && premise.length && !premise.includes(r.decision);
  const text = premiseWrong
    ? `${r.appId} is not ${VERB[premise![0]]}. It is ${VERB[r.decision]}: ${r.headline}`
    : `${r.appId} (${r.name}) is ${VERB[r.decision]}. ${r.headline}`;
  const sections: ReplySection[] = [];
  if (r.reasons.length) sections.push({ title: 'Why', bullets: r.reasons });
  if (r.asks.length) sections.push({ title: 'What we need from them', bullets: r.asks, tone: 'warn' });
  if (r.conditions.length)
    sections.push({ title: 'Conditions', bullets: r.conditions.map((c) => `${c.text} (owner: ${c.owner}, within ${c.deadlineDays} days)`), tone: 'warn' });
  if (r.redirect)
    sections.push({
      title: 'Suggested pin',
      bullets: [
        `${r.redirect.pin} ${r.redirect.pinName} in ${r.redirect.territoryId}: ${km(r.redirect.km)} from their pin, demand ${r.redirect.demandIndex}/100, payback ${mo(r.redirect.paybackMonths)}.`,
      ],
      tone: 'good',
    });
  if (r.nextSteps.length) sections.push({ title: 'Next steps', bullets: r.nextSteps });
  if (r.whatWouldChange.length) sections.push({ title: 'What would change this', bullets: r.whatWouldChange });
  const bullets: string[] = [];
  if (duplicates.length > 1)
    bullets.push(`${duplicates.length} rows use ${r.appId} (Excel rows ${duplicates.map((d) => d.uid.split('#row')[1] ?? '?').join(', ')}). Showing the first one.`);
  return {
    text,
    bullets,
    sections,
    focus: { ...refOf(r), headline: r.headline, numbers: keyNumbers(r) },
    tone: premiseWrong ? 'warn' : 'info',
    followUps: followUpsFor(r),
  };
}

function followUpsFor(r: Result): string[] {
  const f: string[] = [];
  if (r.decision === 'Hold' && r.asks.length) f.push(`${r.appId} has now sent the missing details`);
  if (r.economics.capitalGapLakh > 0) f.push(`${r.appId} got a loan of ${Math.ceil(r.economics.capitalGapLakh)} lakh`);
  if (r.place.pin && !r.reasonCodes.some((c) => /SPACE/.test(c)) && r.decision !== 'Approve') f.push(`${r.appId} has now found a ground-floor space`);
  if (r.territoryId) f.push(`What happened in ${r.territoryId}?`);
  return f.slice(0, 3);
}

// ---------------------------------------------------------------- list

function describeFilter(f: ListFilter): string {
  const parts: string[] = [];
  if (f.decisions) parts.push(f.decisions.length > 1 ? 'approved (with or without conditions)' : VERB[f.decisions[0]]);
  if (f.flagged) parts.push('with data issues');
  if (f.city) parts.push(`in ${f.city}`);
  if (f.territoryId) parts.push(`in ${f.territoryId}`);
  return parts.join(' ') || 'matching';
}

export function listReply(output: EngineOutput, f: ListFilter): Reply {
  const rows = output.results
    .filter((r) => !f.decisions || f.decisions.includes(r.decision))
    .filter((r) => !f.city || r.city === f.city)
    .filter((r) => !f.territoryId || r.territoryId === f.territoryId)
    .filter((r) => !f.flagged || r.flags.some((x) => x.severity !== 'info'))
    .sort((a, b) => b.combinedScore - a.combinedScore);
  const what = describeFilter(f);
  if (!rows.length) {
    return { text: `Nobody is ${what}.`, bullets: [], tone: 'info', followUps: ['Who is on hold?', 'Where should we open next?'] };
  }
  const bullets = rows.slice(0, 8).map((r) => `${r.appId} ${r.name} (${r.city}${r.territoryId ? `, ${r.territoryId}` : ''}): ${r.headline}`);
  if (rows.length > 8) bullets.push(`…and ${rows.length - 8} more (all listed below).`);
  const byDec = new Map<Decision, number>();
  rows.forEach((r) => byDec.set(r.decision, (byDec.get(r.decision) ?? 0) + 1));
  const split = f.decisions && f.decisions.length === 1 ? '' : ` (${[...byDec].map(([d, n]) => `${n} ${VERB[d]}`).join(', ')})`;
  return {
    text: `${rows.length} applicant${rows.length === 1 ? ' is' : 's are'} ${what}${split}. Sorted by combined score.`,
    bullets,
    cards: rows.map(refOf),
  };
}

// ---------------------------------------------------------------- compare

export function compareReply(a: Result, b: Result): Reply {
  type Row = CompareTable['rows'][number];
  const num = (label: string, va: number | null, vb: number | null, fmt: (v: number | null) => string, higherBetter = true): Row => ({
    label,
    a: fmt(va),
    b: fmt(vb),
    better: va === null || vb === null || va === vb ? (va === null && vb !== null ? 'b' : vb === null && va !== null ? 'a' : null) : (va > vb) === higherBetter ? 'a' : 'b',
  });
  const rows: Row[] = [
    { label: 'Decision', a: a.decision, b: b.decision, better: null },
    num('Combined score', a.combinedScore, b.combinedScore, (v) => (v === null ? '—' : sc(v))),
    num('Partner score', a.partnerScore, b.partnerScore, (v) => (v === null ? '—' : sc(v))),
    num('Place score', a.place.placeScore, b.place.placeScore, (v) => (v === null ? '—' : sc(v))),
    num('Readiness', a.readiness, b.readiness, (v) => (v === null ? '—' : sc(v))),
    num('Payback', a.economics.paybackMonths, b.economics.paybackMonths, (v) => (v === null ? 'none' : `${v.toFixed(0)} mo`), false),
    num('Cash gap', a.economics.capitalGapLakh, b.economics.capitalGapLakh, (v) => (v ? lakh(v) : 'none'), false),
    num('Nearest store', a.place.nearestStore?.km ?? null, b.place.nearestStore?.km ?? null, km),
    { label: 'Pin · territory', a: `${a.pin ?? '—'} · ${a.territoryId ?? 'none'}`, b: `${b.pin ?? '—'} · ${b.territoryId ?? 'none'}`, better: null },
  ];
  const lead = a.combinedScore === b.combinedScore ? null : a.combinedScore > b.combinedScore ? a : b;
  const other = lead === a ? b : a;
  const strongest = lead
    ? (
        [
          ['partner score', lead.partnerScore - other.partnerScore],
          ['place score', lead.place.placeScore - other.place.placeScore],
          ['readiness', lead.readiness - other.readiness],
        ] as [string, number][]
      ).sort((x, y) => y[1] - x[1])[0]
    : null;
  let text = lead
    ? `${lead.appId} ranks higher (combined ${sc(lead.combinedScore)} vs ${sc(other.combinedScore)})${strongest && strongest[1] > 0 ? `, mainly on ${strongest[0]} (+${Math.round(strongest[1])})` : ''}.`
    : `${a.appId} and ${b.appId} have the same combined score (${sc(a.combinedScore)}).`;
  const bullets: string[] = [];
  if (a.pin && a.pin === b.pin) bullets.push(`Both want pin ${a.pin}. The brand never opens two stores in one pin, so only one can take it.`);
  if (a.territoryId && a.territoryId === b.territoryId) bullets.push(`Both compete in ${a.territoryId}.`);
  bullets.push(`${a.appId}: ${a.headline}`, `${b.appId}: ${b.headline}`);
  if (lead) text += ` ${lead.appId} is ${VERB[lead.decision]}; ${other.appId} is ${VERB[other.decision]}.`;
  return { text, bullets, compare: { a: refOf(a), b: refOf(b), rows }, cards: [refOf(a), refOf(b)] };
}

// ---------------------------------------------------------------- territory

export function territoryReply(output: EngineOutput, terId: string): Reply {
  const t = output.territories.find((x) => x.id.toUpperCase() === terId.toUpperCase());
  if (!t) {
    const ids = output.territories.map((x) => x.id);
    return {
      text: `I can't find ${terId} in the Territories sheet.`,
      bullets: ids.length ? [`Territories in this file: ${ids.join(', ')}.`] : ['No territories were read from the file.'],
      tone: 'warn',
    };
  }
  const bullets = [t.reason];
  if (t.suggestRaisePriority) bullets.push(`Demand here looks stronger than its ${t.priority} priority. Consider raising the priority.`);
  const sections: ReplySection[] = [];
  if (t.filled.length) sections.push({ title: `Slots filled (${t.filled.length} of ${t.openSlots})`, bullets: t.filled.map((f) => `${f.appId} ${f.name}, pin ${f.pin}: ${f.decision}, combined ${sc(f.combinedScore)}`), tone: 'good' });
  else sections.push({ title: `Slots filled (0 of ${t.openSlots})`, bullets: [t.openSlots === 0 ? 'This territory has no open slots.' : 'No applicant cleared every check for these slots.'] });
  if (t.contenders.length) sections.push({ title: 'Others who applied here', bullets: t.contenders.map((c) => `${c.appId} ${c.name}: ${c.decision}, combined ${sc(c.combinedScore)}. ${c.note}`) });
  const refs: ApplicantRef[] = [
    ...t.filled.map((f) => ({ uid: f.uid, appId: f.appId, name: f.name, decision: f.decision })),
    ...t.contenders.map((c) => ({ uid: c.uid, appId: c.appId, name: c.name, decision: c.decision })),
  ];
  return {
    text: `${t.id} · ${t.city} · ${t.tier} · ${t.priority} priority: ${t.filled.length} of ${t.openSlots} slot${t.openSlots === 1 ? '' : 's'} filled, ${t.filled.length + t.contenders.length} applicant${t.filled.length + t.contenders.length === 1 ? '' : 's'}.`,
    bullets,
    sections,
    cards: refs,
  };
}

// ---------------------------------------------------------------- gaps

export function gapsReply(output: EngineOutput, city?: string): Reply {
  const gaps = output.gaps.filter((g) => !city || g.city === city).sort((a, b) => b.demandIndex - a.demandIndex);
  if (!gaps.length) return { text: `No open demand gaps found${city ? ` in ${city}` : ''}.`, bullets: [], tone: 'info' };
  const top = gaps.slice(0, 6);
  return {
    text: `Top ${top.length} pins with demand but no store or approved applicant${city ? ` in ${city}` : ''} (demand is from simulated order data):`,
    bullets: top.map(
      (g) =>
        `${g.pin} ${g.name} (${g.city}${g.territoryId ? `, ${g.territoryId}` : ', no territory'}): demand ${g.demandIndex}/100${g.onlineOrders !== null ? `, ${g.onlineOrders.toLocaleString('en-IN')} online orders` : ''}, ${km(g.nearestStoreKm)} to the nearest store, ${g.applicants} applicant${g.applicants === 1 ? '' : 's'}. ${g.note}`,
    ),
    followUps: ['Show redirects', 'Who is waitlisted?'],
  };
}

// ---------------------------------------------------------------- help

export const EXAMPLES = [
  'Why is APP-007 on hold?',
  'APP-012 has now found a ground-floor space',
  'Who is on hold?',
  'Who is waitlisted in Mysuru?',
  'What happened in TER-02?',
  'Compare APP-003 and APP-045',
  'Where should we open next?',
];

export function helpReply(): Reply {
  return {
    text: 'Ask about any applicant, territory or gap, or tell me new information and I will re-run the rules.',
    bullets: [],
    sections: [
      { title: 'Questions', bullets: ['Why is APP-007 on hold?', 'Tell me about APP-045', 'Compare APP-003 and APP-045', 'What happened in TER-02?', 'Who is waitlisted in Mysuru?', 'Where should we open next?'] },
      {
        title: 'New information (re-runs the decision)',
        bullets: [
          'APP-012 has now found a ground-floor space',
          'APP-007 space is 600 sq ft',
          'APP-038 got a loan of 10 lakh',
          'APP-015 hired a manager with 5 years experience',
          'APP-081 wants to open in 4 months',
          'APP-013 moved to 570020',
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- main

export function buildAnswer(intent: Intent, output: EngineOutput | null, _parse?: ParseResult | null): Reply {
  if (intent.kind === 'help') return helpReply();
  if (!output || !output.results.length) return noData();
  switch (intent.kind) {
    case 'explain': {
      const rs = findByAppId(output, intent.appId);
      if (!rs.length) return unknownIdReply(output, intent.appId);
      return explainReply(rs[0], intent.premise, rs);
    }
    case 'unknownId':
      return unknownIdReply(output, intent.appId);
    case 'list':
      return listReply(output, intent.filter);
    case 'compare': {
      const a = findByAppId(output, intent.a)[0];
      const b = findByAppId(output, intent.b)[0];
      if (!a) return unknownIdReply(output, intent.a);
      if (!b) return unknownIdReply(output, intent.b);
      if (a.uid === b.uid) return explainReply(a);
      return compareReply(a, b);
    }
    case 'territory':
      return territoryReply(output, intent.terId);
    case 'gaps':
      return gapsReply(output, intent.city);
    case 'ambiguous': {
      const refs = intent.candidates.flatMap((id) => findByAppId(output, id).slice(0, 1)).map(refOf);
      return {
        text: `${refs.length} applicants match "${intent.query}". Which one do you mean?`,
        bullets: refs.slice(0, 8).map((r) => `${r.appId} ${r.name}: ${r.decision}`),
        cards: refs,
        followUps: refs.slice(0, 3).map((r) => `Explain ${r.appId}`),
      };
    }
    case 'update':
      // Updates are applied by the page (they change app state); see buildUpdateReply.
      return { text: 'Applying the update…', bullets: [] };
    case 'unknown':
    default:
      return {
        text: "I didn't catch that. I answer from the rules engine, so try an application ID, a territory ID or one of these:",
        bullets: EXAMPLES.slice(0, 5),
        tone: 'warn',
        followUps: EXAMPLES.slice(0, 3),
      };
  }
}

export function unknownIdReply(output: EngineOutput, appId: string): Reply {
  const close = closeIds(output, appId);
  return {
    text: `I can't find ${appId} in the uploaded file (${output.results.length} applications).`,
    bullets: close.length ? [`Closest IDs: ${close.join(', ')}.`] : [],
    cards: close.flatMap((id) => findByAppId(output, id).slice(0, 1)).map(refOf),
    tone: 'warn',
  };
}

// ---------------------------------------------------------------- updates

export interface OutcomeLike {
  target: { before: Result; after: Result } | null;
  changes: DecisionChange[];
}

function metricRows(b: Result, a: Result): MetricRow[] {
  const rows: [string, string, string][] = [
    ['Partner score', sc(b.partnerScore), sc(a.partnerScore)],
    ['Place score', sc(b.place.placeScore), sc(a.place.placeScore)],
    ['Readiness', sc(b.readiness), sc(a.readiness)],
    ['Combined score', sc(b.combinedScore), sc(a.combinedScore)],
    ['Payback', mo(b.economics.paybackMonths), mo(a.economics.paybackMonths)],
    ['Cash gap', b.economics.capitalGapLakh > 0 ? lakh(b.economics.capitalGapLakh) : 'none', a.economics.capitalGapLakh > 0 ? lakh(a.economics.capitalGapLakh) : 'none'],
    ['Conditions', String(b.conditions.length), String(a.conditions.length)],
    ['Missing info', String(b.asks.length), String(a.asks.length)],
    ['Rank in territory', b.rankInTerritory ? `#${b.rankInTerritory}` : '—', a.rankInTerritory ? `#${a.rankInTerritory}` : '—'],
  ];
  return rows.map(([label, before, after]) => ({ label, before, after, changed: before !== after }));
}

export function buildUpdateReply(appId: string, resolved: ResolvedUpdate, outcome: OutcomeLike): Reply {
  if (!outcome.target) {
    return { text: `I understood the update for ${appId}, but could not re-run the decision (no engine result for it).`, bullets: [], tone: 'error' };
  }
  const { before, after } = outcome.target;
  const changed = before.decision !== after.decision;
  const ripple = outcome.changes.filter((c) => c.uid !== after.uid);
  const metrics = metricRows(before, after);
  const diff: UpdateDiff = {
    appId: after.appId,
    uid: after.uid,
    name: after.name,
    understood: resolved.changes.map((c) => ({ label: c.label, from: c.from, to: c.to })),
    assumptions: resolved.assumptions,
    before: { decision: before.decision, headline: before.headline },
    after: { decision: after.decision, headline: after.headline },
    decisionChanged: changed,
    metrics,
    ripple,
  };
  const moved = metrics.filter((m) => m.changed && m.label !== 'Rank in territory').map((m) => `${m.label.toLowerCase()} ${m.before} → ${m.after}`);
  const text = changed
    ? `Re-ran the rules. ${after.appId} moves from ${before.decision} to ${after.decision}. ${after.headline}`
    : `Re-ran the rules. ${after.appId} stays ${VERB[after.decision]}${moved.length ? ` (${moved.slice(0, 3).join(', ')})` : ''}. ${after.headline}`;
  const sections: ReplySection[] = [];
  if (!changed) {
    if (after.reasons.length) sections.push({ title: "Why it didn't change", bullets: after.reasons.slice(0, 3) });
    if (after.whatWouldChange.length) sections.push({ title: 'What would change it', bullets: after.whatWouldChange });
  } else {
    if (after.reasons.length) sections.push({ title: 'Why', bullets: after.reasons.slice(0, 4) });
  }
  if (after.asks.length) sections.push({ title: 'Still needed', bullets: after.asks, tone: 'warn' });
  if (after.conditions.length) sections.push({ title: 'Conditions', bullets: after.conditions.map((c) => `${c.text} (within ${c.deadlineDays} days)`), tone: 'warn' });
  if (changed && after.nextSteps.length) sections.push({ title: 'Next steps', bullets: after.nextSteps.slice(0, 4) });
  return {
    text,
    bullets: ripple.length ? [`${ripple.length} other applicant${ripple.length === 1 ? '' : 's'} affected (slot allocation re-ran for the territory).`] : [],
    sections,
    diff,
    tone: changed ? 'info' : 'info',
  };
}

export function noChangeUpdateReply(r: Result, assumptions: string[]): Reply {
  return {
    text: `That matches what we already have for ${r.appId}, so nothing was re-run. It is still ${VERB[r.decision]}.`,
    bullets: assumptions,
    focus: { ...refOf(r), headline: r.headline, numbers: keyNumbers(r) },
  };
}

export function withdrawReply(output: EngineOutput, r: Result): Reply {
  const bullets = ['Withdrawal is logged in the activity feed for the expansion manager. The row stays in the decision table until the source file is updated.'];
  const t = r.territoryId ? output.territories.find((x) => x.id === r.territoryId) : undefined;
  if (t && (r.decision === 'Approve' || r.decision === 'Approve with conditions')) {
    const next = [...t.contenders].sort((a, b) => b.combinedScore - a.combinedScore).find((c) => c.decision === 'Waitlist');
    bullets.push(next ? `${r.appId} held a slot in ${t.id}. Next in line: ${next.appId} ${next.name} (combined ${sc(next.combinedScore)}).` : `${r.appId} held a slot in ${t.id}; nobody is waitlisted there, so the slot would reopen.`);
  }
  return { text: `Noted: ${r.appId} (${r.name}) has withdrawn. Current decision was ${VERB[r.decision]}.`, bullets, cards: [refOf(r)], tone: 'warn' };
}
