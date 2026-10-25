// Engine entry point: runAll(parse, ctx) → one decision per applicant, territory fill, gaps and a summary.
// Contract: pure + deterministic. Same ParseResult + EngineContext → identical EngineOutput (including `hash`).
// Decision order follows docs/rulebook.md P0-P8; every number comes from src/config/rules.ts.
import type {
  Application, City, Condition, DataFlag, Decision, EngineContext, EngineOutput, Floor, GapPin, LaunchPlan, ParseResult, Partnership,
  PlaceInfo, Redirect, Result, ScoreItem, SpaceAvailable, Territory, TerritoryStatus, Tier,
} from '../types';
import { DECISIONS } from '../types';
import {
  AS_OF_DATE, BUFFER_MONTHS, CAPITAL_GAP, CITY_PIN_PREFIX, COMBINED_WEIGHTS, COMMITMENT, HOLD_SLOT_DAYS, MAX_CONDITIONS_FOR_APPROVAL, OVERLAP_RADIUS_KM,
  PARTNER_BAR, PARTNER_WEIGHTS, PAYBACK_TARGET_MONTHS, SPACE_SQFT, TIER_ECONOMICS, ZERO_EXPERIENCE_MIN_SCORE,
} from '../config/rules';
import { haversineKm } from '../lib/geo';
import { cityFromPin, demandIndexFor } from './demand';
import { capitalBand, economicsFor, type CapitalBand } from './economics';
import { buildLaunchPlan, festivalCheck, planDaysFor } from './launch';
import { NOTE_PATTERNS } from './parse';
import { capitalFitPoints, partnerScore, type PartnerScore } from './partner';
import { buildGeo, nearestStore, placeFor, placeScoreOf, territoryOrder, type Geo } from './place';
import { addDays, fnv1a, km, lakh, prettyDate, round1, round2 } from './util';

/** Redirects stay within this distance of the applicant's own pin unless the notes say "anywhere in the city". Engine assumption. */
export const REDIRECT_MAX_KM: Record<Tier, number> = { 'Tier 1': 12, 'Tier 2': 10, 'Tier 3': 10 };
/** Size assumed when chat says a space was found but gives no size (confirmed later). */
const ASSUMED_CHAT_SIZE = SPACE_SQFT.ideal;

type Status = 'hold' | 'decline' | 'noTerritory' | 'blocked' | 'paybackFail' | 'notReady' | 'eligible';

interface Scenario {
  space: SpaceAvailable | null;
  size: number | null;
  floor: Floor | null;
}

interface Eval {
  app: Application;
  flags: DataFlag[];
  sc: Scenario;
  hasSite: boolean;
  econFloor: Floor | null; // floor used for sales: Ground when there is no site yet (the site condition asks for ground floor)
  place: ReturnType<typeof placeFor>;
  econ: ReturnType<typeof economicsFor>;
  band: CapitalBand;
  partner: PartnerScore;
  zeroExp: boolean;
  readiness: number;
  combined: number;
  status: Status;
  codes: string[];
  why: string[]; // gate reasons (with numbers)
  conditions: Condition[];
  asks: string[];
  chatNote: string | null;
  holdSlot: boolean; // held applicant whose best case could win a slot
  bestCombined: number;
  p1Outlook?: string | null; // P1 hold: the decline the other checks already point to
}

// ---------------------------------------------------------------- flags + asks
const ASK_TEXT: Record<string, (a: Application, f: DataFlag) => string> = {
  PIN_INVALID: () => 'Send the correct 6-digit pin code of the proposed shop.',
  PIN_NOT_IN_CITY: (a) => {
    const pc = a.pin ? cityFromPin(a.pin) : null;
    return pc
      ? `Confirm the city and pin: pin ${a.pin} is in ${pc}, but the form says ${a.city}. Send the right pin for the shop (${a.city} pins start with ${CITY_PIN_PREFIX[a.city as City] ?? '?'}).`
      : `Confirm the pin code: ${a.pin} is not in any city we expand in.`;
  },
  CITY_UNKNOWN: (a) => {
    const pc = a.pin ? cityFromPin(a.pin) : null;
    return `Confirm the city (Bengaluru, Mysuru, Mangaluru, Hubballi-Dharwad, Belagavi, Tumakuru or Davanagere)${pc ? `; the pin suggests ${pc}` : ''}.`;
  },
  INVESTMENT_MISSING: () => 'Send the amount you can invest, in ₹ lakh.',
  EXPERIENCE_MISSING: () => 'Send your years of retail (shop) experience; write 0 if none.',
  SPACE_SIZE_MISSING: () => 'Send the shop size in sq ft (carpet area).',
  SPACE_SIZE_WITHOUT_SPACE: (a) =>
    `Confirm if you have a space: the form says "Not yet identified" but gives ${a.spaceSizeSqft} sq ft. If you have it, send the address and whether it is owned or rented.`,
  NOTES_CONTRADICT_SPACE: (a) => `Confirm if the shop is already ${String(a.spaceAvailable).toLowerCase()} or you are still searching; if you have it, send the address and size.`,
  NOTES_CONTRADICT_FLOOR: () => 'Confirm the floor: the form says Ground but the notes mention an upper floor. Send a photo of the shopfront from the road.',
  SPACE_MISSING: () => 'Tell us if the shop space is Owned, Rented or Not yet identified.',
  LANGUAGE_MISSING: () => 'Confirm the training language: Kannada, English or Hindi.',
  LANGUAGE_NOT_SUPPORTED: (a) => `Training is offered in Kannada, English or Hindi ("${a.languageRaw}" is not available). Pick one.`,
  LAUNCH_MISSING: () => 'Confirm when you want to open (months from now).',
  DUPLICATE_ID: (a) => `Confirm your Application ID (${a.id} is also used by another applicant).`,
  NAME_MISSING: () => "Send the applicant's full name.",
};
const askFor = (a: Application, f: DataFlag) => (ASK_TEXT[f.code] ? ASK_TEXT[f.code](a, f) : null);

/** Re-derive the flags that depend on fields changed through chat, so stale upload flags never drive a decision. */
function currentFlags(app: Application): DataFlag[] {
  const updated = new Set((app.updates ?? []).map((u) => u.field));
  if (!updated.size) return app.flags;
  const spaceTouched = updated.has('spaceAvailable') || updated.has('spaceSizeSqft');
  const floorTouched = updated.has('floor');
  const pinTouched = updated.has('pin') || updated.has('city');
  const drop = new Set<string>();
  if (spaceTouched) ['SPACE_SIZE_MISSING', 'SPACE_SIZE_WITHOUT_SPACE', 'NOTES_CONTRADICT_SPACE', 'SPACE_MISSING', 'SIZE_PARSED_FROM_TEXT'].forEach((c) => drop.add(c));
  if (floorTouched) ['NOTES_CONTRADICT_FLOOR', 'FLOOR_MISSING', 'FLOOR_INVALID'].forEach((c) => drop.add(c));
  if (pinTouched) ['PIN_INVALID', 'PIN_NOT_IN_CITY', 'CITY_UNKNOWN', 'PIN_CLEANED', 'CITY_NORMALISED'].forEach((c) => drop.add(c));
  const kept = app.flags.filter((f) => !drop.has(f.code) && !(f.field && updated.has(f.field)));
  const add = (code: string, severity: DataFlag['severity'], message: string, field: keyof Application) => kept.push({ code, severity, message, field });
  if (updated.has('investmentLakh') && app.investmentLakh === null) add('INVESTMENT_MISSING', 'block', 'Investment capacity is blank.', 'investmentLakh');
  if (updated.has('experienceYears') && app.experienceYears === null) add('EXPERIENCE_MISSING', 'block', 'Retail experience is blank.', 'experienceYears');
  if (pinTouched) {
    const pc = app.pin ? cityFromPin(app.pin) : null;
    if (!app.pin) add('PIN_INVALID', 'block', 'Pin code is not a 6-digit pin.', 'pin');
    else if (!CITY_PIN_PREFIX[app.city as City]) add('CITY_UNKNOWN', 'block', `City "${app.city}" is not one of the 7 cities.`, 'city');
    else if (pc !== app.city) add('PIN_NOT_IN_CITY', 'block', `Pin ${app.pin} is in ${pc ?? 'no city we cover'}, but the form says ${app.city}.`, 'pin');
  }
  if (spaceTouched) {
    const fromChat = updated.has('spaceAvailable');
    if (!app.spaceAvailable) add('SPACE_MISSING', 'ask', 'Space available is blank.', 'spaceAvailable');
    if ((app.spaceAvailable === 'Owned' || app.spaceAvailable === 'Rented') && app.spaceSizeSqft === null && !fromChat)
      add('SPACE_SIZE_MISSING', 'ask', `Space is ${app.spaceAvailable} but the size is blank.`, 'spaceSizeSqft');
    // a chat saying "still searching" makes the old size stale, so it is not a contradiction
    if (app.spaceAvailable === 'Not yet identified' && app.spaceSizeSqft !== null && !(fromChat && !updated.has('spaceSizeSqft')))
      add('SPACE_SIZE_WITHOUT_SPACE', 'ask', `Space is "Not yet identified" but a size of ${app.spaceSizeSqft} sq ft is given.`, 'spaceSizeSqft');
    // notes were written before the chat update, so they no longer contradict the space field
  }
  if (floorTouched && !app.floor) add('FLOOR_MISSING', 'info', 'Floor is blank; read as Not known.', 'floor');
  if (!floorTouched && !spaceTouched && app.floor === 'Ground' && NOTE_PATTERNS.upperFloor.test(app.notes) && !kept.some((f) => f.code === 'NOTES_CONTRADICT_FLOOR'))
    add('NOTES_CONTRADICT_FLOOR', 'ask', `Floor says Ground, but the notes say "${app.notes}".`, 'floor');
  return kept;
}

function chatSpaceAssumption(app: Application): boolean {
  return (
    (app.updates ?? []).some((u) => u.field === 'spaceAvailable') &&
    (app.spaceAvailable === 'Owned' || app.spaceAvailable === 'Rented') &&
    app.spaceSizeSqft === null
  );
}

function describeUpdates(app: Application): string | null {
  const ups = app.updates ?? [];
  if (!ups.length) return null;
  const last = new Map<string, { from: unknown; to: unknown; source: string }>();
  for (const u of ups) last.set(u.field, { from: last.get(u.field)?.from ?? u.from, to: u.to, source: u.source });
  const LABEL: Record<string, string> = {
    spaceAvailable: 'space', spaceSizeSqft: 'size (sq ft)', floor: 'floor', investmentLakh: 'investment (₹ L)', experienceYears: 'experience (yrs)',
    pin: 'pin', city: 'city', targetLaunchMonths: 'target launch (months)', preferredLanguage: 'language', notes: 'notes', currentBusiness: 'business',
  };
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? 'blank' : String(v));
  const parts = [...last.entries()].map(([f, v]) => `${LABEL[f] ?? f} ${fmt(v.from)} → ${fmt(v.to)}`);
  let s = `Updated from chat: ${parts.join(', ')}.`;
  if (chatSpaceAssumption(app)) s += ` Size not given yet, so ${ASSUMED_CHAT_SIZE} sq ft is assumed until the lease is confirmed.`;
  return s;
}

/** "560037 Marathahalli Colony", or just "580023" when the pin is not in our map data (no "580023 Pin 580023"). */
const pinLbl = (p: { pin: string | null; pinName: string }) =>
  p.pin ? (p.pinName && p.pinName !== `Pin ${p.pin}` ? `${p.pin} ${p.pinName}` : p.pin) : 'unknown pin';

// ---------------------------------------------------------------- per-applicant evaluation (P1-P6, P8 static)
interface Ctx {
  geo: Geo;
}

function hasSiteOf(sc: Scenario): boolean {
  return (sc.space === 'Owned' || sc.space === 'Rented') && (sc.size === null || sc.size >= SPACE_SQFT.compactMin);
}

function readinessOf(sc: Scenario, hasSite: boolean, app: Application): number {
  const plan = planDaysFor(hasSite);
  const months = app.targetLaunchMonths ?? 6;
  return (sc.floor === 'Ground' || sc.floor === 'Mall unit' ? 50 : 0) + (months * 30 >= plan ? 50 : 0);
}

function combinedOf(partner: number, place: number, readiness: number) {
  return round2(COMBINED_WEIGHTS.partner * partner + COMBINED_WEIGHTS.place * place + COMBINED_WEIGHTS.readiness * readiness);
}

/** Static conditions (everything except the catchment check against stores approved in this run). */
function staticConditions(
  app: Application,
  sc: Scenario,
  hasSite: boolean,
  place: PlaceInfo,
  econ: ReturnType<typeof economicsFor>,
  band: CapitalBand,
  zeroExp: boolean,
  opts: { chatAssumed: boolean; sitePinLabel: string },
): Condition[] {
  const c: Condition[] = [];
  const plan = planDaysFor(hasSite);
  if (band === 'condition') {
    const capacity = app.investmentLakh ?? 0;
    c.push(
      capacity >= econ.requiredInvestmentLakh
        ? { code: 'BUFFER_SHORT', text: `Keep 3 months of fixed cost as a cash buffer: ${lakh(econ.capitalGapLakh)} more needed (total need ${lakh(econ.totalCashNeedLakh)}, you have ${lakh(capacity)}). Show a loan sanction or co-investor proof within 30 days.`, deadlineDays: 30, owner: 'Partner + Finance' }
        : { code: 'CAPITAL_GAP', text: `Close the funding gap of ${lakh(econ.capitalGapLakh)} (${Math.round(econ.capitalGapPct * 100)}% of the ${lakh(econ.totalCashNeedLakh)} total need): loan sanction or co-investor proof within 30 days.`, deadlineDays: 30, owner: 'Partner + Finance' },
    );
  }
  if (band === 'compact')
    c.push({ code: 'CAPITAL_COMPACT', text: `Funding is ${Math.round(econ.capitalGapPct * 100)}% short (${lakh(econ.capitalGapLakh)}): switch to the compact format (300-399 sq ft) and show funding proof for the rest within 30 days.`, deadlineDays: 30, owner: 'Partner + Finance' });
  if (hasSite && sc.size !== null && sc.size < SPACE_SQFT.ideal)
    c.push({ code: 'SIZE_COMPACT', text: `${sc.size} sq ft is below the ${SPACE_SQFT.ideal} sq ft standard: use the compact layout (brand approves the layout within 21 days).`, deadlineDays: 21, owner: 'Projects team' });
  if (!hasSite) {
    const tiny = (sc.space === 'Owned' || sc.space === 'Rented') && sc.size !== null && sc.size < SPACE_SQFT.compactMin;
    c.push({
      code: 'NO_SITE',
      text: `${tiny ? `The ${sc.size} sq ft space is too small (under ${SPACE_SQFT.compactMin}). ` : ''}Find a ground-floor site of ${SPACE_SQFT.ideal}+ sq ft in or near ${opts.sitePinLabel} and pass the brand site audit within 45 days.`,
      deadlineDays: 45,
      owner: 'Partner + Expansion manager',
    });
  }
  if (zeroExp)
    c.push({ code: 'ZERO_EXPERIENCE', text: 'No retail experience: hire a store manager with 2+ years of retail experience before fit-out ends, and complete 4 weeks of training and shadowing.', deadlineDays: 60, owner: 'Partner + Training team' });
  if (app.targetLaunchMonths !== null && app.targetLaunchMonths * 30 < plan)
    c.push({ code: 'LAUNCH_SHORT', text: `Target of ${app.targetLaunchMonths} month${app.targetLaunchMonths === 1 ? '' : 's'} is shorter than the ${plan}-day plan: agree a realistic opening date of ${prettyDate(addDays(plan))}.`, deadlineDays: 7, owner: 'Expansion manager' });
  const fest = festivalCheck(app.notes, plan);
  if (fest.conflict) c.push({ code: 'FESTIVAL_CONFLICT', text: fest.note!, deadlineDays: 7, owner: 'Expansion manager' });
  if (place.insideOverlapRadius && place.nearestStore)
    c.push({ code: 'CATCHMENT_CHECK', text: `Catchment check: ${km(place.nearestStore.km)} from ${place.nearestStore.id} ${place.nearestStore.area} (overlap radius ${place.overlapRadiusKm} km). Confirm it won't take that store's customers.`, deadlineDays: 21, owner: 'Expansion manager' });
  if (place.locationApproximate)
    c.push({ code: 'LOCATION_UNVERIFIED', text: `Pin ${place.pin ?? '?'} is not in our map data: visit and verify the site location and the distance to the nearest store.`, deadlineDays: 14, owner: 'Expansion manager' });
  if (opts.chatAssumed)
    c.push({ code: 'CONFIRM_LEASE', text: `Send the signed lease or ownership papers and the exact size (assumed ${ASSUMED_CHAT_SIZE} sq ft) within 14 days.`, deadlineDays: 14, owner: 'Partner' });
  return c;
}

function compactPossible(sc: Scenario): boolean {
  if (sc.floor === 'Mall unit') return false;
  if (sc.space === 'Owned' || sc.space === 'Rented') return sc.size === null || sc.size >= SPACE_SQFT.compactMin;
  return true; // can still pick a compact site
}

function evaluateScenario(app: Application, sc: Scenario, x: Ctx, chatAssumed: boolean): Omit<Eval, 'flags' | 'asks' | 'chatNote' | 'holdSlot' | 'bestCombined'> {
  const place = placeFor(app.pin, String(app.city), x.geo);
  const codes: string[] = [];
  const why: string[] = [];
  let scen = sc;
  // P4: owned/rented space at a pin that already has a store does not count
  if (place.samePinAsStore && (sc.space === 'Owned' || sc.space === 'Rented')) scen = { space: 'Not yet identified', size: null, floor: 'Not known' };
  const hasSite = hasSiteOf(scen);
  const econFloor: Floor | null = hasSite ? scen.floor : 'Ground';
  const econ = economicsFor(place.tier, place.demandIndex, econFloor, app.investmentLakh);
  const band = capitalBand(econ);
  const partner = partnerScore(app, scen.space, econ);
  const zeroExp = (app.experienceYears ?? 0) < 1;
  const readiness = readinessOf(scen, hasSite, app);
  const combined = combinedOf(partner.score, place.placeScore, readiness);
  const sitePinLabel = pinLbl(place);
  let conditions = staticConditions(app, scen, hasSite, place, econ, band, zeroExp, { chatAssumed, sitePinLabel });
  let status: Status = 'eligible';

  const decline = (code: string, text: string) => {
    status = 'decline';
    codes.push(code);
    why.push(text);
  };
  // P2: partner bar / capital gap
  if (band === 'decline') {
    decline('CAPITAL_GAP_OVER_30', `Funding is ${Math.round(econ.capitalGapPct * 100)}% short: ${lakh(app.investmentLakh ?? 0)} available vs ${lakh(econ.totalCashNeedLakh)} total cash need (${lakh(econ.requiredInvestmentLakh)} investment + ${lakh(econ.bufferLakh)} buffer). Over 30% short is a decline.`);
  } else if (zeroExp) {
    const ok = partner.score >= ZERO_EXPERIENCE_MIN_SCORE && band === 'pass' && !place.samePinAsStore && econ.paybackPass;
    if (!ok) {
      const miss: string[] = [];
      if (partner.score < ZERO_EXPERIENCE_MIN_SCORE) miss.push(`partner score ${partner.score} is below ${ZERO_EXPERIENCE_MIN_SCORE}`);
      if (band !== 'pass') miss.push(`funding ${lakh(app.investmentLakh ?? 0)} does not cover the full ${lakh(econ.totalCashNeedLakh)} need`);
      if (place.samePinAsStore) miss.push(`pin ${place.pin} already has store ${place.samePinAsStore}`);
      if (!econ.paybackPass) miss.push(econ.paybackMonths === null ? 'the site does not make a profit' : `payback ${round1(econ.paybackMonths)} months is over ${PAYBACK_TARGET_MONTHS}`);
      decline('ZERO_EXPERIENCE_NOT_ELIGIBLE', `No retail experience, and the 0-year route needs every check to pass: ${miss.join('; ')}.`);
    } else codes.push('ZERO_EXPERIENCE_ROUTE');
  } else if (partner.score < PARTNER_BAR.conditional) {
    const weakest = [...partner.items].sort((a, b) => a.score * a.weight - b.score * b.weight)[0];
    decline('PARTNER_BELOW_BAR', `Partner score ${partner.score} is below the ${PARTNER_BAR.conditional} bar (weakest: ${weakest.label.toLowerCase()} ${weakest.score}/100).`);
  }
  if (status === 'eligible') {
    if (!place.territoryId) {
      status = 'noTerritory';
      codes.push('NO_TERRITORY');
      why.push(`Pin ${place.pin ?? '?'} is not in any territory${place.pin ? ` in ${cityFromPin(place.pin) ?? app.city}` : ''}, so there is no slot to give.`);
    } else if (place.samePinAsStore) {
      status = 'blocked';
      codes.push('SAME_PIN_EXISTING_STORE');
      why.push(`Pin ${place.pin} already has store ${place.samePinAsStore} (${place.nearestStore?.area ?? ''}); the brand never opens two stores in one pin.`);
    } else if (!econ.paybackPass) {
      status = 'paybackFail';
      codes.push('PAYBACK_FAIL');
      why.push(
        econ.paybackMonths === null
          ? `This site does not make a profit: sales ${lakh(econ.monthlySalesLakh)}/month × 35% margin is below fixed cost ${lakh(econ.monthlyFixedCostLakh)}.`
          : `Payback ${round1(econ.paybackMonths)} months is over the ${PAYBACK_TARGET_MONTHS}-month target (sales ${lakh(econ.monthlySalesLakh)}/month, profit ${lakh(econ.monthlyProfitLakh)}/month, ${econFloor ?? 'Not known'} floor${hasSite ? '' : ', assumed for the site still to be found'}).`,
      );
    } else if (band === 'compact' && !compactPossible(scen)) {
      status = 'notReady';
      codes.push('CAPITAL_GAP_NO_COMPACT');
      why.push(`Funding is ${Math.round(econ.capitalGapPct * 100)}% short and a smaller format does not fit this ${scen.floor === 'Mall unit' ? 'mall unit' : 'space'}.`);
      conditions = conditions.filter((c) => c.code !== 'CAPITAL_COMPACT');
    } else if (conditions.length > MAX_CONDITIONS_FOR_APPROVAL) {
      status = 'notReady';
      codes.push('TOO_MANY_CONDITIONS');
      why.push(`${conditions.length} open conditions (${conditions.map((c) => c.code.toLowerCase().replace(/_/g, ' ')).join(', ')}); more than ${MAX_CONDITIONS_FOR_APPROVAL} means not ready yet.`);
    }
  }
  return { app, sc: scen, hasSite, econFloor, place, econ, band, partner, zeroExp, readiness, combined, status, codes, why, conditions };
}

const outcomeKey = (e: { status: Status; conditions: Condition[] }) =>
  e.status === 'eligible' ? (e.conditions.length === 0 ? 'approve' : 'approve-c') : e.status;

function evaluate(app: Application, x: Ctx): Eval {
  const flags = currentFlags(app);
  const chatAssumed = chatSpaceAssumption(app);
  const asks = [...new Set(flags.filter((f) => f.severity !== 'info').map((f) => askFor(app, f)).filter((s): s is string => !!s))];
  const chatNote = describeUpdates(app);
  const base: Scenario = { space: app.spaceAvailable, size: chatAssumed ? ASSUMED_CHAT_SIZE : app.spaceSizeSqft, floor: app.floor };

  // P1: required field invalid / pin does not match city → Hold
  const blocking = flags.filter((f) => f.severity === 'block');
  if (blocking.length) {
    const e = evaluateScenario(app, base, x, chatAssumed);
    return {
      ...e, flags, asks, chatNote, holdSlot: false, bestCombined: e.combined, status: 'hold',
      codes: blocking.map((f) => f.code), why: blocking.map((f) => f.message), conditions: [],
      // what the other checks say on the numbers we have, so the manager is not surprised after the fix
      p1Outlook: e.status === 'decline' && !blocking.some((f) => f.field === 'investmentLakh' || f.field === 'experienceYears') ? e.why[0] : null,
    };
  }

  // P5: try uncertain fields at their best and worst values
  const has = (code: string) => flags.some((f) => f.code === code);
  const best: Scenario = { ...base };
  const worst: Scenario = { ...base };
  const uncertain: string[] = [];
  if (has('SPACE_MISSING')) {
    best.space = 'Owned'; best.size = best.size ?? SPACE_SQFT.ideal;
    worst.space = 'Not yet identified'; worst.size = null;
    uncertain.push('SPACE_MISSING');
  }
  if (has('SPACE_SIZE_MISSING') && !chatAssumed) {
    best.size = SPACE_SQFT.ideal;
    worst.size = SPACE_SQFT.compactMin - 1;
    uncertain.push('SPACE_SIZE_MISSING');
  }
  if (has('SPACE_SIZE_WITHOUT_SPACE')) {
    best.space = 'Rented';
    worst.space = 'Not yet identified'; worst.size = null;
    uncertain.push('SPACE_SIZE_WITHOUT_SPACE');
  }
  if (has('NOTES_CONTRADICT_SPACE')) {
    worst.space = 'Not yet identified'; worst.size = null;
    uncertain.push('NOTES_CONTRADICT_SPACE');
  }
  if (has('NOTES_CONTRADICT_FLOOR')) {
    best.floor = 'Ground';
    worst.floor = 'Upper';
    uncertain.push('NOTES_CONTRADICT_FLOOR');
  }
  if (!uncertain.length) {
    const e = evaluateScenario(app, base, x, chatAssumed);
    return { ...e, flags, asks, chatNote, holdSlot: false, bestCombined: e.combined };
  }
  const eb = evaluateScenario(app, best, x, chatAssumed);
  const ew = evaluateScenario(app, worst, x, chatAssumed);
  if (outcomeKey(eb) !== outcomeKey(ew)) {
    const label = (k: string) =>
      ({ approve: 'Approve', 'approve-c': 'Approve with conditions', decline: 'Decline', noTerritory: 'Waitlist (no territory)', blocked: 'Redirect (pin already taken)', paybackFail: 'fails payback (Redirect, Waitlist or Decline)', notReady: 'Waitlist (not ready yet)', hold: 'Hold', eligible: 'Approve' })[k] ?? k;
    const unclear = flags.filter((f) => uncertain.includes(f.code)).map((f) => f.message);
    // Name each reading in plain words (the "best" reading is not always the better outcome, e.g. an owned upper-floor shop).
    const READING: Record<string, [string, string]> = {
      SPACE_SIZE_MISSING: [`with ${SPACE_SQFT.ideal}+ sq ft`, `under ${SPACE_SQFT.compactMin} sq ft`],
      SPACE_MISSING: ['with a space secured', 'without a space'],
      SPACE_SIZE_WITHOUT_SPACE: ['if the space is secured', 'if no space yet'],
      NOTES_CONTRADICT_SPACE: [`if the space is ${String(app.spaceAvailable ?? '').toLowerCase()} as the form says`, 'if still searching'],
      NOTES_CONTRADICT_FLOOR: ['on a ground floor', 'on an upper floor'],
    };
    const [rb, rw] = uncertain.length === 1 && READING[uncertain[0]] ? READING[uncertain[0]] : ['on one reading of the form', 'on the other'];
    // hold keeps the as-typed view for scores; asks say exactly what to send
    const e = evaluateScenario(app, base, x, chatAssumed);
    const eligible = [eb, ew].filter((s) => s.status === 'eligible');
    return {
      ...e, flags, asks, chatNote, status: 'hold', conditions: [],
      codes: ['HOLD_INFO_CHANGES_OUTCOME', ...uncertain],
      why: [...unclear, `The answer changes the decision: ${rb}, ${label(outcomeKey(eb))}; ${rw}, ${label(outcomeKey(ew))}.`],
      holdSlot: eligible.length > 0,
      bestCombined: eligible.length ? Math.max(...eligible.map((s) => s.combined)) : eb.combined,
    };
  }
  // same outcome either way: continue on the best reading, keep the asks
  return { ...eb, flags, asks, chatNote, holdSlot: false, bestCombined: eb.combined, codes: [...eb.codes, 'ASK_ATTACHED'] };
}

// ---------------------------------------------------------------- partnerships (pairs)
/**
 * PARTNERSHIPS: pair an INVESTOR (money, little or no retail experience) with an OPERATOR (experience, short of money)
 * in the same territory, so the operator runs the store and the investor funds it. Deterministic, in four steps:
 *
 * 1. Pool (per territory, only territories with open slots): applicants whose pin is in the territory, excluding any Hold
 *    (blocking data problems or missing facts), duplicate IDs, and anyone who already moves forward on their own
 *    (Approve, Approve with conditions or Redirect in a dry run of the allocation without pairs).
 * 2. Roles: INVESTOR = experience ≤ 1 year AND investment ≥ 40% of the tier's total cash need (investment + 3-month buffer).
 *    OPERATOR = experience ≥ 3 years AND category relevance ≥ 70/100 (same or adjacent retail) AND a capital gap > 0.
 * 3. A pair is valid when: the site is a free pin (the better of the two applicants' pins: one with a ready space first,
 *    then the higher place score; never an existing store's pin), combined capacity ≥ the total cash need at that site,
 *    payback at the site is within target, and the pair carries no more than MAX_CONDITIONS_FOR_APPROVAL conditions
 *    (the partnership agreement counts as one). Joint partner score uses PARTNER_WEIGHTS: experience, relevance and
 *    involvement from the operator (who runs the store full-time), commitment from the better space of the two (plus a
 *    manager/co-investor named by either), capital fit from the combined capacity. Readiness comes from the site owner's
 *    space, floor and timeline; combined score uses COMBINED_WEIGHTS.
 * 4. Greedy matching per territory: rank valid pairs by combined score (tie-break operator ID, then investor ID),
 *    take the best, remove both people, repeat. Each person is in at most one pair.
 *
 * Matched pairs then COMPETE for slots in allocation pass 1 alongside individuals (one pair = one slot, one pin).
 * A pair that wins → both are "Approve with conditions" (partnership agreement within 30 days) and status "allocated".
 * Otherwise the pair is "suggested": individual decisions stay, and both results say who the suggested partner is and
 * where the pair would rank.
 */
export const PARTNERSHIP_RULES = {
  investorMaxYears: 1,
  investorMinShareOfNeed: 0.4,
  operatorMinYears: 3,
  operatorMinRelevance: 70,
  /**
   * Operator must be short by more than this share of the total cash need: a smaller gap is already handled by a
   * loan-proof condition (CAPITAL_GAP.conditionMax), so a partner would only add a second owner for ₹1-2 L.
   */
  operatorMinGapShare: CAPITAL_GAP.conditionMax,
  agreementDays: 30,
  /**
   * Points taken off a pair's combined score for partnership risk (two owners must agree; a split can close the store).
   * Engine assumption, tune in the pilot. At 0 a pair's capital fit is always 100, so pairs took 12 of the sample's 21
   * slots and pushed out stronger solo partners; at 5 a pair must clearly beat a solo applicant (7 of 21 on the sample).
   */
  combinedPenalty: 5,
};

interface PairCand {
  id: string;
  op: Eval;
  inv: Eval;
  owner: Eval; // the applicant whose pin is the site
  territory: Territory;
  place: ReturnType<typeof placeFor>;
  sc: Scenario;
  hasSite: boolean;
  econFloor: Floor | null;
  econ: ReturnType<typeof economicsFor>;
  partner: PartnerScore;
  readiness: number;
  combined: number;
  capacity: number;
  investorFunds: number;
  operatorGap: number;
  conditions: Condition[];
}

/** Total cash need for a tier (standard investment + 3-month buffer, non-mall). */
function tierNeed(tier: Tier): number {
  const t = TIER_ECONOMICS[tier];
  return t.investmentLakh + BUFFER_MONTHS * t.fixedCostLakh;
}
const relevanceScore = (e: Eval) => e.partner.items.find((i) => i.label === 'Category relevance')?.score ?? 0;
const experienceScore = (e: Eval) => e.partner.items.find((i) => i.label === 'Experience')?.score ?? 0;
const yearsText = (y: number) => (y === 0 ? 'no retail experience' : `${y} year${y === 1 ? '' : 's'} of retail experience`);

function jointPartnerScore(op: Eval, inv: Eval, econ: ReturnType<typeof economicsFor>, capacity: number): PartnerScore {
  const opItem = (label: string) => op.partner.items.find((i) => i.label === label)!;
  const spaces = [op, inv].map((e) => ({ e, pts: COMMITMENT.spacePoints[e.sc.space ?? 'Not yet identified'] }));
  spaces.sort((a, b) => b.pts - a.pts || a.e.app.id.localeCompare(b.e.app.id));
  const bestSpace = spaces[0];
  const mgrBy = [op, inv].filter((e) => e.partner.hasManagerOrCoInvestor).map((e) => e.app.id);
  const commit = COMMITMENT.spaceWeight * bestSpace.pts + COMMITMENT.managerOrCoInvestorWeight * (mgrBy.length ? 100 : 0);
  const cap = capitalFitPoints(capacity, econ.totalCashNeedLakh);
  const exp = opItem('Experience');
  const rel = opItem('Category relevance');
  const inv2 = opItem('Owner involvement');
  const items: ScoreItem[] = [
    { label: 'Experience', weight: PARTNER_WEIGHTS.experience, score: exp.score, note: `${op.app.id} (runs the store): ${exp.note.charAt(0).toLowerCase()}${exp.note.slice(1)}` },
    { label: 'Category relevance', weight: PARTNER_WEIGHTS.relevance, score: rel.score, note: `${op.app.id}: ${rel.note}` },
    {
      label: 'Commitment',
      weight: PARTNER_WEIGHTS.commitment,
      score: round2(commit),
      note: `Best space of the two: ${bestSpace.e.sc.space ?? 'not given'} (${bestSpace.e.app.id}, ${bestSpace.pts}); ${mgrBy.length ? `manager / co-investor named by ${mgrBy.join(' and ')}` : 'no manager or co-investor named'}`,
    },
    {
      label: 'Capital fit',
      weight: PARTNER_WEIGHTS.capitalFit,
      score: cap,
      note: `₹${round2(capacity)} L combined (${op.app.id} ₹${op.app.investmentLakh} L + ${inv.app.id} ₹${inv.app.investmentLakh} L) vs ₹${econ.totalCashNeedLakh} L total cash need`,
    },
    { label: 'Owner involvement', weight: PARTNER_WEIGHTS.involvement, score: inv2.score, note: `${op.app.id}: ${inv2.note}` },
  ];
  const score = round2(items.reduce((s, i) => s + i.weight * i.score, 0));
  return { score, items, relevance: op.partner.relevance, involvement: op.partner.involvement, hasManagerOrCoInvestor: mgrBy.length > 0 };
}

function buildPair(op: Eval, inv: Eval, t: Territory, geo: Geo): PairCand | null {
  const sites = [op, inv].filter((e) => e.place.pin && e.place.territoryId === t.id && !geo.storePins.has(e.place.pin) && !e.place.samePinAsStore);
  if (!sites.length) return null;
  sites.sort(
    (a, b) =>
      Number(b.hasSite) - Number(a.hasSite) || b.place.placeScore - a.place.placeScore || a.place.pin!.localeCompare(b.place.pin!) || (a === op ? -1 : 1),
  );
  const owner = sites[0];
  const capacity = round2((op.app.investmentLakh ?? 0) + (inv.app.investmentLakh ?? 0));
  const econ = economicsFor(owner.place.tier, owner.place.demandIndex, owner.econFloor, capacity);
  if (econ.capitalGapLakh > 0 || !econ.paybackPass) return null;
  const partner = jointPartnerScore(op, inv, econ, capacity);
  const combined = round2(combinedOf(partner.score, owner.place.placeScore, owner.readiness) - PARTNERSHIP_RULES.combinedPenalty);
  const opCap = op.app.investmentLakh ?? 0;
  const investorFunds = round2(Math.max(0, econ.totalCashNeedLakh - opCap));
  const statics = staticConditions({ ...owner.app, investmentLakh: capacity }, owner.sc, owner.hasSite, owner.place, econ, 'pass', false, {
    chatAssumed: chatSpaceAssumption(owner.app),
    sitePinLabel: pinLbl(owner.place),
  });
  const agreement: Condition = {
    code: 'PARTNERSHIP_AGREEMENT',
    text: `Sign a partnership agreement within ${PARTNERSHIP_RULES.agreementDays} days: ${op.app.id} runs the store day to day, ${inv.app.id} funds ${lakh(investorFunds)} (${op.app.id} puts in ${lakh(Math.min(opCap, econ.totalCashNeedLakh))}).`,
    deadlineDays: PARTNERSHIP_RULES.agreementDays,
    owner: 'Both partners + Legal',
  };
  const conditions = [agreement, ...statics];
  if (conditions.length > MAX_CONDITIONS_FOR_APPROVAL) return null;
  return {
    id: `PAIR-${op.app.id}+${inv.app.id}`,
    op, inv, owner, territory: t, place: owner.place, sc: owner.sc, hasSite: owner.hasSite, econFloor: owner.econFloor, econ, partner,
    readiness: owner.readiness, combined, capacity, investorFunds, operatorGap: round2(Math.max(0, econ.totalCashNeedLakh - opCap)), conditions,
  };
}

function matchPartnerships(evals: Eval[], forwardAlone: Set<string>, geo: Geo, territories: Territory[]): PairCand[] {
  const out: PairCand[] = [];
  const R = PARTNERSHIP_RULES;
  for (const t of [...territories].sort(territoryOrder)) {
    if (t.openSlots <= 0) continue;
    const pool = evals.filter(
      (e) =>
        e.place.territoryId === t.id &&
        e.status !== 'hold' &&
        !e.flags.some((f) => f.severity === 'block' || f.code === 'DUPLICATE_ID') &&
        !forwardAlone.has(e.app.uid) &&
        e.app.investmentLakh !== null &&
        e.app.experienceYears !== null,
    );
    const investors = pool.filter((e) => e.app.experienceYears! <= R.investorMaxYears && e.app.investmentLakh! >= R.investorMinShareOfNeed * tierNeed(e.place.tier));
    const operators = pool.filter((e) => e.app.experienceYears! >= R.operatorMinYears && relevanceScore(e) >= R.operatorMinRelevance && e.econ.capitalGapLakh > 0 && e.econ.capitalGapPct > R.operatorMinGapShare);
    const valid: PairCand[] = [];
    for (const op of operators) for (const inv of investors) {
      const p = buildPair(op, inv, t, geo);
      if (p) valid.push(p);
    }
    valid.sort(
      (a, b) =>
        b.combined - a.combined || a.op.app.id.localeCompare(b.op.app.id) || a.inv.app.id.localeCompare(b.inv.app.id) ||
        a.op.app.rowNumber - b.op.app.rowNumber || a.inv.app.rowNumber - b.inv.app.rowNumber,
    );
    const used = new Set<string>();
    for (const p of valid) {
      if (used.has(p.op.app.uid) || used.has(p.inv.app.uid)) continue;
      used.add(p.op.app.uid);
      used.add(p.inv.app.uid);
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------- allocation (P7) + output
interface Final {
  decision: Decision;
  codes: string[];
  slotNote: string | null;
  redirect: (Redirect & { econ: ReturnType<typeof economicsFor>; conditions: Condition[] }) | null;
  extraConditions: Condition[];
  winners?: string[]; // uids, or "pair:<id>" for a pair
  noOffer?: string | null; // why no redirect could be offered
  pair?: string; // set when the applicant won the slot as part of this partnership
}

function tieBreak(a: Eval, b: Eval, key: (e: Eval) => number = (e) => e.combined): number {
  return (
    key(b) - key(a) ||
    b.partner.score - a.partner.score ||
    (b.app.investmentLakh ?? 0) - (a.app.investmentLakh ?? 0) ||
    (b.app.experienceYears ?? 0) - (a.app.experienceYears ?? 0) ||
    a.app.id.localeCompare(b.app.id) ||
    a.app.rowNumber - b.app.rowNumber
  );
}

/** A contender for a territory's slots: one applicant, or a matched pair. */
type Cand = { e: Eval; p?: undefined } | { p: PairCand; e?: undefined };
function candKey(c: Cand) {
  return c.p
    ? { key: c.p.combined, partner: c.p.partner.score, inv: c.p.capacity, exp: c.p.op.app.experienceYears ?? 0, id: c.p.op.app.id, row: c.p.op.app.rowNumber, sub: c.p.inv.app.id }
    : { key: c.e.status === 'hold' ? c.e.bestCombined : c.e.combined, partner: c.e.partner.score, inv: c.e.app.investmentLakh ?? 0, exp: c.e.app.experienceYears ?? 0, id: c.e.app.id, row: c.e.app.rowNumber, sub: '' };
}
/** Same order as tieBreak for individuals; a pair ties after its operator, then by investor ID. */
function cmpCand(a: Cand, b: Cand): number {
  const x = candKey(a);
  const y = candKey(b);
  return y.key - x.key || y.partner - x.partner || y.inv - x.inv || y.exp - x.exp || x.id.localeCompare(y.id) || x.row - y.row || x.sub.localeCompare(y.sub);
}
const slotContender = (e: Eval) => e.status === 'eligible' || (e.status === 'hold' && e.holdSlot);

interface Allocation {
  finals: Map<string, Final>;
  reserved: Map<string, string>;
  pairWon: Set<string>;
  pairSkip: Map<string, string>; // pair id → why it did not get a slot although it ranked high enough
}

function allocate(parse: ParseResult, geo: Geo, evals: Eval[], byUid: Map<string, Eval>, pairs: PairCand[]): Allocation {
  const slotsLeft = new Map(parse.territories.map((t) => [t.id, t.openSlots]));
  const reserved = new Map<string, string>(); // pin → uid
  const reservedPts: { pin: string; uid: string; lat: number; lng: number; tier: Tier }[] = [];
  const finals = new Map<string, Final>();
  const redirectPool: Eval[] = [];
  const pairWon = new Set<string>();
  const pairSkip = new Map<string, string>();
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  const reserve = (e: Eval, pin: string, tier: Tier) => {
    reserved.set(pin, e.app.uid);
    const info = geo.pinInfo(pin);
    if (info) reservedPts.push({ pin, uid: e.app.uid, lat: info.lat, lng: info.lng, tier });
  };
  const nearReserved = (pin: string, tier: Tier) => {
    const info = geo.pinInfo(pin);
    if (!info) return null;
    let best: { uid: string; pin: string; km: number } | null = null;
    for (const r of reservedPts) {
      const d = haversineKm(info, r);
      if (d < OVERLAP_RADIUS_KM[tier] && (!best || d < best.km)) best = { uid: r.uid, pin: r.pin, km: d };
    }
    return best;
  };

  const terrSorted = [...parse.territories].sort(territoryOrder);
  type Offer = { pin: string; t: Territory; km: number; place: ReturnType<typeof placeFor>; econ: ReturnType<typeof economicsFor>; conds: Condition[] };
  /** Best free pin for a redirect: same city, territory with a free slot, outside every overlap radius, pays back on a ground floor. */
  const findRedirect = (e: Eval, onlyTerritory?: string) => {
    const city = (e.place.pin && cityFromPin(e.place.pin)) || (e.app.city as City);
    const originInfo = geo.pinInfo(e.place.pin);
    const anywhere = /anywhere in the city|any location|anywhere/i.test(e.app.notes);
    const maxKm = anywhere ? Infinity : REDIRECT_MAX_KM[e.place.tier];
    let best: Offer | null = null;
    let alt: { pin: string; name: string; t: string; payback: number | null } | null = null; // passes payback but no free slot
    let tooMany: { pin: string; name: string; km: number; conds: string[] } | null = null; // free slot, pays back, but too many conditions
    for (const t of terrSorted) {
      if (onlyTerritory && t.id !== onlyTerritory) continue;
      const free = (slotsLeft.get(t.id) ?? 0) > 0;
      for (const p of t.pins) {
        if (p === e.place.pin || reserved.has(p) || geo.storePins.has(p) || cityFromPin(p) !== city) continue;
        const info = geo.pinInfo(p);
        if (!info) continue;
        const dist = originInfo ? haversineKm(originInfo, info) : 0;
        if (dist > maxKm) continue;
        const pl = placeFor(p, city, geo);
        if (pl.territoryId !== t.id || pl.insideOverlapRadius || nearReserved(p, pl.tier)) continue;
        const ec = economicsFor(pl.tier, pl.demandIndex, 'Ground', e.app.investmentLakh);
        if (!ec.paybackPass) continue;
        const band = capitalBand(ec);
        if (band === 'decline') continue;
        const sc: Scenario = { space: 'Not yet identified', size: null, floor: 'Ground' };
        const conds = staticConditions(e.app, sc, false, pl, ec, band, e.zeroExp, { chatAssumed: false, sitePinLabel: `${p} ${pl.pinName}` });
        if (!free) {
          if (!alt || (ec.paybackMonths ?? 99) < (alt.payback ?? 99)) alt = { pin: p, name: pl.pinName, t: t.id, payback: ec.paybackMonths };
          continue;
        }
        if (conds.length > MAX_CONDITIONS_FOR_APPROVAL) {
          if (!tooMany || dist < tooMany.km) tooMany = { pin: p, name: pl.pinName, km: dist, conds: conds.map((c) => c.code.toLowerCase().replace(/_/g, ' ')) };
          continue;
        }
        const better = !best || pl.placeScore > best.place.placeScore || (pl.placeScore === best.place.placeScore && (dist < best.km || (dist === best.km && p < best.pin)));
        if (better) best = { pin: p, t, km: dist, place: pl, econ: ec, conds };
      }
    }
    // plain-words reason when nothing can be offered
    const why = best
      ? null
      : tooMany
        ? `The nearest free pin, ${tooMany.pin} ${tooMany.name} (${km(tooMany.km)} away), would carry ${tooMany.conds.length} conditions (${tooMany.conds.join(', ')}); more than ${MAX_CONDITIONS_FOR_APPROVAL} means not ready, so no redirect was offered.`
        : alt
          ? `Pins that would work (e.g. ${alt.pin} ${alt.name} in ${alt.t}) are in territories whose slots are already filled, so no redirect was offered.`
          : `No free pin in ${city}${Number.isFinite(maxKm) ? ` within ${maxKm} km` : ''} sits in a territory with an open slot and passes the overlap and payback checks, so no redirect was offered.`;
    const whyShort = best ? null : tooMany ? 'the nearest free pin would carry too many conditions' : alt ? 'nearby territories with a workable pin are full' : 'no free pin nearby passes the checks';
    return { best, alt, tooMany, why, whyShort };
  };
  const applyRedirect = (e: Eval, best: Offer, prev: Final | undefined) => {
    reserve(e, best.pin, best.place.tier);
    slotsLeft.set(best.t.id, (slotsLeft.get(best.t.id) ?? 0) - 1);
    finals.set(e.app.uid, {
      decision: 'Redirect',
      codes: [...(prev?.codes ?? []), 'REDIRECT_OFFERED'],
      slotNote: prev?.slotNote ?? null,
      redirect: {
        pin: best.pin, pinName: best.place.pinName, territoryId: best.t.id, km: round2(best.km), demandIndex: best.place.demandIndex,
        paybackMonths: best.econ.paybackMonths, econ: best.econ, conditions: best.conds,
      },
      extraConditions: [],
      winners: prev?.winners,
    });
  };
  /** Holds a slot or a pin already (so cannot also join a pair). */
  const hasSlot = (uid: string) => {
    const d = finals.get(uid)?.decision;
    return d === 'Approve' || d === 'Approve with conditions' || d === 'Redirect' || d === 'Hold';
  };

  // Pass 1: direct applicants and matched pairs, territory by territory (priority, then ID).
  // A same-pin clash loser is offered another free pin in the same territory straight away, in rank order,
  // so a lower-ranked applicant never takes the slot ahead of them.
  for (const t of terrSorted) {
    const cands: Cand[] = [
      ...evals.filter((e) => e.place.territoryId === t.id && slotContender(e)).map((e) => ({ e })),
      ...pairs.filter((p) => p.territory.id === t.id).map((p) => ({ p })),
    ].sort(cmpCand);
    const winners: string[] = [];
    for (const c of cands) {
      if (c.p) {
        const p = c.p;
        const pin = p.place.pin!;
        const taken = [p.op, p.inv].filter((m) => hasSlot(m.app.uid));
        if (taken.length) {
          pairSkip.set(p.id, `${taken.map((m) => m.app.id).join(' and ')} already won a slot on their own`);
          continue;
        }
        if ((slotsLeft.get(t.id) ?? 0) <= 0) continue; // ranked below the slot winners
        if (reserved.has(pin)) {
          pairSkip.set(p.id, `the site pin ${pin} went to ${byUid.get(reserved.get(pin)!)?.app.id ?? 'another applicant'}`);
          continue;
        }
        const extra: Condition[] = [];
        const near = nearReserved(pin, p.place.tier);
        if (near && !p.conditions.some((x) => x.code === 'CATCHMENT_CHECK')) {
          const other = byUid.get(near.uid)!;
          extra.push({ code: 'CATCHMENT_CHECK', text: `Catchment check: ${km(near.km)} from ${other.app.id}'s new store at ${near.pin} (overlap radius ${OVERLAP_RADIUS_KM[p.place.tier]} km). Confirm the two stores won't share customers.`, deadlineDays: 21, owner: 'Expansion manager' });
        }
        if (p.conditions.length + extra.length > MAX_CONDITIONS_FOR_APPROVAL) {
          pairSkip.set(p.id, `a store approved ${km(near!.km)} away adds a catchment check, which makes too many conditions`);
          continue;
        }
        reserve(p.op, pin, p.place.tier);
        slotsLeft.set(t.id, (slotsLeft.get(t.id) ?? 0) - 1);
        winners.push(`pair:${p.id}`);
        pairWon.add(p.id);
        for (const m of [p.op, p.inv]) finals.set(m.app.uid, { decision: 'Approve with conditions', codes: ['PAIR_SLOT_WON'], slotNote: null, redirect: null, extraConditions: extra, pair: p.id });
        continue;
      }
      const e = c.e;
      if (finals.get(e.app.uid)?.pair) continue; // already approved as part of a pair
      const pin = e.place.pin!;
      if (t.openSlots === 0) {
        if (e.status !== 'hold') finals.set(e.app.uid, { decision: 'Waitlist', codes: ['ZERO_SLOTS'], slotNote: `${t.id} has 0 open slots right now.`, redirect: null, extraConditions: [] });
        continue;
      }
      if ((slotsLeft.get(t.id) ?? 0) <= 0) {
        if (e.status === 'hold') continue;
        finals.set(e.app.uid, { decision: 'Waitlist', codes: ['SLOT_LOST'], slotNote: null, redirect: null, extraConditions: [], winners: [...winners] });
        redirectPool.push(e);
        continue;
      }
      if (reserved.has(pin)) {
        if (e.status === 'hold') continue;
        const holder = byUid.get(reserved.get(pin)!)!;
        const holderPair = finals.get(holder.app.uid)?.pair;
        const holderScore = holderPair ? (pairById.get(holderPair)?.combined ?? holder.combined) : holder.combined;
        const lost: Final = { decision: 'Waitlist', codes: ['PIN_TAKEN_IN_RUN'], slotNote: `Pin ${pin} went to ${holderPair ? `the ${pairById.get(holderPair)!.op.app.id} + ${pairById.get(holderPair)!.inv.app.id} partnership` : holder.app.id} (combined score ${holderScore} vs ${e.combined}).`, redirect: null, extraConditions: [] };
        const { best } = findRedirect(e, t.id);
        if (best) {
          applyRedirect(e, best, lost);
          winners.push(e.app.uid);
        } else {
          finals.set(e.app.uid, lost);
          redirectPool.push(e);
        }
        continue;
      }
      const extra: Condition[] = [];
      const near = nearReserved(pin, e.place.tier);
      if (near && e.status !== 'hold') {
        const other = byUid.get(near.uid)!;
        extra.push({ code: 'CATCHMENT_CHECK', text: `Catchment check: ${km(near.km)} from ${other.app.id}'s new store at ${near.pin} (overlap radius ${OVERLAP_RADIUS_KM[e.place.tier]} km). Confirm the two stores won't share customers.`, deadlineDays: 21, owner: 'Expansion manager' });
        if (e.conditions.some((c) => c.code === 'CATCHMENT_CHECK')) extra.length = 0;
        if (e.conditions.length + extra.length > MAX_CONDITIONS_FOR_APPROVAL) {
          finals.set(e.app.uid, { decision: 'Waitlist', codes: ['NEIGHBOUR_APPROVED'], slotNote: `${other.app.id} was approved ${km(near.km)} away, which adds a catchment check and makes too many conditions.`, redirect: null, extraConditions: [] });
          redirectPool.push(e);
          continue;
        }
      }
      reserve(e, pin, e.place.tier);
      slotsLeft.set(t.id, (slotsLeft.get(t.id) ?? 0) - 1);
      winners.push(e.app.uid);
      if (e.status === 'hold') {
        finals.set(e.app.uid, { decision: 'Hold', codes: ['SLOT_HELD'], slotNote: `Slot in ${t.id} held for ${HOLD_SLOT_DAYS} days (until ${prettyDate(addDays(HOLD_SLOT_DAYS))}) because the best case would win it.`, redirect: null, extraConditions: [] });
      } else {
        const n = e.conditions.length + extra.length;
        finals.set(e.app.uid, { decision: n === 0 ? 'Approve' : 'Approve with conditions', codes: ['SLOT_WON'], slotNote: null, redirect: null, extraConditions: extra });
      }
    }
    for (const w of winners) {
      const uids = w.startsWith('pair:') ? [pairById.get(w.slice(5))!.op.app.uid, pairById.get(w.slice(5))!.inv.app.uid] : [w];
      for (const uid of uids) {
        const f = finals.get(uid);
        if (f) f.winners = winners;
      }
    }
  }
  for (const e of evals) {
    if ((e.status === 'blocked' || e.status === 'paybackFail') && !finals.get(e.app.uid)?.pair) redirectPool.push(e);
  }

  // Pass 2: redirects to free pins in territories with free slots (same city).
  // Ordered by partner score: the place score at the applicant's own pin (0 on a store pin) says nothing about the pin offered.
  redirectPool.sort((a, b) => tieBreak(a, b, (e) => e.partner.score));
  for (const e of redirectPool) {
    const cur = finals.get(e.app.uid);
    if (cur?.decision === 'Redirect' || cur?.pair) continue;
    const { best, alt, tooMany, why, whyShort } = findRedirect(e);
    const prev = finals.get(e.app.uid);
    if (best) {
      applyRedirect(e, best, prev);
    } else if (e.status === 'paybackFail' && alt) {
      finals.set(e.app.uid, {
        decision: 'Waitlist', codes: ['PAYBACK_FAIL_ALT_PIN_NO_SLOT'],
        slotNote: `${alt.pin} ${alt.name} (${alt.t}) would pay back in ${round1(alt.payback ?? 0)} months on a ground floor, but its territory has no free slot.`,
        redirect: null, extraConditions: [],
      });
    } else if (e.status === 'paybackFail' && tooMany) {
      finals.set(e.app.uid, { decision: 'Waitlist', codes: ['PAYBACK_FAIL_ALT_PIN_NOT_READY'], slotNote: why, redirect: null, extraConditions: [] });
    } else if (e.status === 'paybackFail') {
      finals.set(e.app.uid, { decision: 'Decline', codes: ['PAYBACK_FAIL_NO_ALTERNATIVE'], slotNote: null, redirect: null, extraConditions: [] });
    } else if (e.status === 'blocked') {
      finals.set(e.app.uid, { decision: 'Waitlist', codes: ['NO_FREE_PIN_NEARBY'], slotNote: whyShort, redirect: null, extraConditions: [], noOffer: why });
    } else if (prev && !prev.codes.includes('NO_FREE_PIN_NEARBY')) {
      prev.codes.push('NO_FREE_PIN_NEARBY');
      prev.noOffer = why;
    }
  }
  return { finals, reserved, pairWon, pairSkip };
}

/** What buildResult needs to know about an applicant's partnership. */
interface PairView {
  p: PairCand;
  role: 'operator' | 'investor';
  other: Eval;
  partnership: Partnership;
  launchPlan: LaunchPlan | null;
}

function pairOutcome(p: PairCand, allocated: boolean, rank: number | null, skip: string | undefined): string {
  const t = p.territory;
  if (allocated)
    return `Approved as a pair in ${t.id}: ${p.op.app.id} runs the store at ${pinLbl(p.place)}, ${p.inv.app.id} funds ${lakh(p.investorFunds)}; payback ${round1(p.econ.paybackMonths ?? 0)} months.`;
  const r = rank ?? 0;
  const line =
    skip ? `enough for a slot on score, but ${skip}`
    : r <= t.openSlots ? 'enough for a slot on score'
    : `${r - t.openSlots === 1 ? 'first' : ordinal(r - t.openSlots)} in line for the next slot`;
  return `Suggested pair: would rank ${r} in ${t.id} (${t.openSlots} slot${t.openSlots === 1 ? '' : 's'}) with combined score ${p.combined}, ${line}.`;
}

function pairCovers(p: PairCand): string[] {
  const { op, inv, econ } = p;
  const opYears = op.app.experienceYears ?? 0;
  const invYears = inv.app.experienceYears ?? 0;
  const biz = op.app.currentBusiness.trim();
  const out = [
    `${op.app.id} brings ${opYears} years of retail experience${biz ? ` (${biz})` : ''}: experience ${experienceScore(op)}/100, category relevance ${relevanceScore(op)}/100. ${op.app.id} runs the store day to day.`,
    `${inv.app.id} brings ${lakh(inv.app.investmentLakh ?? 0)}, closing ${op.app.id}'s ${lakh(p.operatorGap)} funding gap: together ${lakh(p.capacity)} vs ${lakh(econ.totalCashNeedLakh)} total cash need (${lakh(econ.requiredInvestmentLakh)} investment + ${lakh(econ.bufferLakh)} 3-month buffer).`,
    `${inv.app.id} has ${yearsText(invYears)}, so on their own they would need a hired store manager; with ${op.app.id} running the store, that gap is covered.`,
  ];
  const size = p.sc.size !== null ? `, ${p.sc.size} sq ft` : '';
  out.push(
    p.hasSite
      ? `Site: ${p.owner.app.id}'s ${String(p.sc.space).toLowerCase()} ${String(p.sc.floor ?? 'Not known').toLowerCase()}-floor space at ${pinLbl(p.place)}${size}; place score ${p.place.placeScore}, sales ${lakh(econ.monthlySalesLakh)}/month, payback ${round1(econ.paybackMonths ?? 0)} months (target ≤ ${PAYBACK_TARGET_MONTHS}).`
      : `Site: none yet; find a ground-floor site in or near ${pinLbl(p.place)} (place score ${p.place.placeScore}); ground-floor sales ${lakh(econ.monthlySalesLakh)}/month, payback ${round1(econ.paybackMonths ?? 0)} months (target ≤ ${PAYBACK_TARGET_MONTHS}).`,
  );
  return out;
}

export function runAll(parse: ParseResult, ctx: EngineContext): EngineOutput {
  const geo = buildGeo(ctx, parse.stores, parse.territories);
  const x: Ctx = { geo };
  const evals = parse.applications.map((a) => evaluate(a, x));
  const byUid = new Map(evals.map((e) => [e.app.uid, e]));
  const terrById = new Map(parse.territories.map((t) => [t.id, t]));

  for (const e of evals) {
    if (e.place.pin && geo.multiTerritoryPins.has(e.place.pin))
      e.flags = [...e.flags, { code: 'PIN_IN_TWO_TERRITORIES', severity: 'info', message: `Pin ${e.place.pin} is listed in ${geo.multiTerritoryPins.get(e.place.pin)!.join(' and ')}; used ${e.place.territoryId} (higher priority).`, field: 'pin' }];
  }

  // Who moves forward on their own is not offered a partner. Start from a dry run without pairs; when pairs then take
  // the slot of someone who was "forward alone", that person becomes pairable and the match re-runs. The excluded set
  // only shrinks, so this ends (deterministically) in at most one pass per applicant.
  const forwardSolo = (fs: Map<string, Final>) =>
    new Set([...fs].filter(([, f]) => !f.pair && (f.decision === 'Approve' || f.decision === 'Approve with conditions' || f.decision === 'Redirect')).map(([uid]) => uid));
  let forwardAlone = forwardSolo(allocate(parse, geo, evals, byUid, []).finals);
  let pairs = matchPartnerships(evals, forwardAlone, geo, parse.territories);
  let alloc = allocate(parse, geo, evals, byUid, pairs);
  for (let i = 0; i < evals.length; i++) {
    const still = forwardSolo(alloc.finals);
    const next = new Set([...forwardAlone].filter((u) => still.has(u)));
    if (next.size === forwardAlone.size) break;
    forwardAlone = next;
    pairs = matchPartnerships(evals, forwardAlone, geo, parse.territories);
    alloc = allocate(parse, geo, evals, byUid, pairs);
  }
  const { finals, reserved, pairWon, pairSkip } = alloc;

  // Ranks within territory among the contenders for its slots (eligible applicants, held applicants with a winnable
  // best case, and pairs that took a slot), so "ranked 2" always means 2nd for the slots. A suggested pair gets the
  // rank it would have among those contenders.
  const rank = new Map<string, number>();
  const pairRank = new Map<string, number>();
  for (const t of parse.territories) {
    const list: Cand[] = [
      ...evals.filter((e) => e.place.territoryId === t.id && slotContender(e)).map((e): Cand => ({ e })),
      ...pairs.filter((p) => p.territory.id === t.id && pairWon.has(p.id)).map((p): Cand => ({ p })),
    ].sort(cmpCand);
    list.forEach((c, i) => (c.p ? pairRank.set(c.p.id, i + 1) : rank.set(c.e.app.uid, i + 1)));
    for (const p of pairs.filter((q) => q.territory.id === t.id && !pairWon.has(q.id))) {
      // members of the pair are not counted against it
      const ahead = list.filter((c) => (c.p || (c.e.app.uid !== p.op.app.uid && c.e.app.uid !== p.inv.app.uid)) && cmpCand(c, { p }) < 0).length;
      pairRank.set(p.id, ahead + 1);
    }
  }

  // Partnerships output + per-applicant view
  const partnerships: Partnership[] = [];
  const pairViews = new Map<string, PairView>();
  for (const p of pairs) {
    const allocated = pairWon.has(p.id);
    const r = pairRank.get(p.id) ?? null;
    const partnership: Partnership = {
      id: p.id,
      operatorUid: p.op.app.uid,
      operatorAppId: p.op.app.id,
      operatorName: p.op.app.name,
      investorUid: p.inv.app.uid,
      investorAppId: p.inv.app.id,
      investorName: p.inv.app.name,
      territoryId: p.territory.id,
      pin: p.place.pin!,
      pinName: p.place.pinName,
      combinedInvestmentLakh: p.capacity,
      totalCashNeedLakh: p.econ.totalCashNeedLakh,
      partnerScore: p.partner.score,
      breakdown: p.partner.items,
      placeScore: p.place.placeScore,
      paybackMonths: p.econ.paybackMonths,
      combinedScore: p.combined,
      rankInTerritory: r,
      covers: pairCovers(p),
      status: allocated ? 'allocated' : 'suggested',
      outcome: pairOutcome(p, allocated, r, pairSkip.get(p.id)),
    };
    partnerships.push(partnership);
    for (const role of ['operator', 'investor'] as const) {
      const me = role === 'operator' ? p.op : p.inv;
      const other = role === 'operator' ? p.inv : p.op;
      let launchPlan: LaunchPlan | null = null;
      if (allocated) {
        launchPlan = buildLaunchPlan({
          app: p.op.app, hasSite: p.hasSite, floor: p.sc.floor, sizeSqft: p.sc.size, zeroExperience: false, partner: p.partner,
          sitePinLabel: pinLbl(p.place), shadowStore: shadowStoreFor(p.owner, geo), capitalCondition: false,
        });
        launchPlan.training.splice(
          1, 0,
          `${p.op.app.id} (operator) does the full training and runs the store; ${p.inv.app.id} (investor) attends the brand induction day and the monthly P&L review.`,
        );
      }
      pairViews.set(me.app.uid, { p, role, other, partnership, launchPlan });
    }
  }

  // ---------------------------------------------------------------- build results
  const results: Result[] = evals.map((e) => buildResult(e, finals.get(e.app.uid), terrById, geo, rank, byUid, finals, pairViews));

  // territories
  const territories: TerritoryStatus[] = [...parse.territories].sort(territoryOrder).map((t) => territoryStatus(t, results, geo, partnerships));

  // gaps
  const gaps = buildGaps(parse, results, geo, ctx, reserved, partnerships);

  // summary
  const byDecision = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<Decision, number>;
  for (const r of results) byDecision[r.decision]++;
  const taken: string[] = [...parse.stores.map((s) => s.pin)];
  for (const r of results) {
    if (r.partnership?.status === 'allocated') {
      // a pair opens one store, at the partnership's site
      if (r.partnership.role === 'operator') taken.push(partnerships.find((p) => p.id === r.partnership!.id)!.pin);
      continue;
    }
    if (r.decision === 'Approve' || r.decision === 'Approve with conditions') taken.push(r.pin ?? '');
    if (r.decision === 'Redirect' && r.redirect) taken.push(r.redirect.pin);
  }
  const pinConflicts = taken.length - new Set(taken).size;
  const hash = fnv1a(
    [
      ...results.map((r) => `${r.uid}:${r.decision}:${r.redirect?.pin ?? ''}:${r.combinedScore}:${r.partnership ? `${r.partnership.id}/${r.partnership.status}` : ''}`),
      ...partnerships.map((p) => `${p.id}:${p.status}:${p.pin}:${p.combinedScore}:${p.rankInTerritory ?? ''}`),
    ]
      .sort()
      .join('|'),
  );
  return {
    results,
    territories,
    gaps,
    partnerships,
    summary: {
      total: results.length,
      byDecision,
      slotsTotal: parse.territories.reduce((s, t) => s + t.openSlots, 0),
      slotsFilled: reserved.size,
      pinConflicts,
      dataIssues: results.filter((r) => r.flags.some((f) => f.severity !== 'info')).length,
    },
    asOf: AS_OF_DATE,
    hash,
  };
}

// ---------------------------------------------------------------- explanations
const CONDITION_TITLE: Record<string, string> = {
  CAPITAL_GAP: 'loan sanction or co-investor proof for the funding gap',
  BUFFER_SHORT: 'proof of the 3-month cash buffer',
  CAPITAL_COMPACT: 'compact-format plan and funding proof',
  SIZE_COMPACT: 'compact layout approved',
  NO_SITE: 'ground-floor site found and audited',
  ZERO_EXPERIENCE: 'experienced store manager hired and training done',
  LAUNCH_SHORT: 'realistic opening date agreed',
  FESTIVAL_CONFLICT: 'new opening date agreed (Diwali not possible)',
  CATCHMENT_CHECK: 'catchment check signed off',
  LOCATION_UNVERIFIED: 'site location verified',
  CONFIRM_LEASE: 'lease papers and exact size sent',
  PARTNERSHIP_AGREEMENT: 'partnership agreement signed (who runs the store, who funds what)',
};
/** Lower-case the first letter of a sentence fragment unless it starts with a code or name (e.g. "TER-15", "ST-02"). */
const lc = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Diwali|Sankranti)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function partnerLine(ps: PartnerScore, joint = false): string {
  const top = [...ps.items].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const band = ps.score >= PARTNER_BAR.strong ? 'strong' : ps.score >= PARTNER_BAR.conditional ? 'conditional' : 'below the bar';
  const note = ps.items[0].note;
  return `${joint ? 'Joint partner score' : 'Partner score'} ${ps.score}/100 (${band}): ${top
    .slice(0, 3)
    .map((i) => `${i.label.toLowerCase()} ${i.score}`)
    .join(', ')}; ${joint ? note : note.toLowerCase()}.`;
}
function placeLine(p: PlaceInfo): string {
  const loc = pinLbl(p);
  const dem = `demand ${round1(p.demandIndex)}/100 (${p.demandSource === 'orders' ? 'simulated order data' : 'demand proxy v1'})`;
  if (p.locationApproximate) return `Place ${loc}: location not in our map data, so distance to stores is unverified; ${dem}; place score ${p.placeScore}.`;
  const near = p.nearestStore ? (p.samePinAsStore ? `same pin as ${p.samePinAsStore}` : `${km(p.nearestStore.km)} from ${p.nearestStore.id} ${p.nearestStore.area}`) : 'no store nearby';
  return `Place ${loc}: ${near}${p.insideOverlapRadius ? ` (inside the ${p.overlapRadiusKm} km overlap radius)` : ''}; ${dem}; place score ${p.placeScore}.`;
}
function moneyLine(ec: Eval['econ'], capacity: number | null, floor: Floor | null, hasSite: boolean, capLabel = 'available'): string {
  const pb = ec.paybackMonths === null ? 'no profit, so no payback' : `payback ${round1(ec.paybackMonths)} months (target ≤ ${PAYBACK_TARGET_MONTHS})`;
  const cap = capacity === null ? 'investment not given' : `${lakh(capacity)} ${capLabel} vs ${lakh(ec.totalCashNeedLakh)} needed${ec.capitalGapLakh > 0 ? ` (${lakh(ec.capitalGapLakh)} short)` : ''}`;
  return `Money (${ec.tier}, ${floor ?? 'Not known'} floor${hasSite ? '' : ' assumed, no site yet'}): sales ${lakh(ec.monthlySalesLakh)}/month, profit ${lakh(ec.monthlyProfitLakh)}/month, ${pb}; ${cap}.`;
}

function buildResult(
  e: Eval,
  f: Final | undefined,
  terrById: Map<string, Territory>,
  geo: Geo,
  rank: Map<string, number>,
  byUid: Map<string, Eval>,
  finals: Map<string, Final>,
  pairViews: Map<string, PairView>,
): Result {
  const app = e.app;
  const pv = pairViews.get(app.uid) ?? null;
  const pairApproved = !!pv && f?.pair === pv.p.id;
  const terr = e.place.territoryId ? terrById.get(e.place.territoryId) : undefined;
  let decision: Decision;
  let headline: string;
  const reasons: string[] = [];
  const codes: string[] = [];
  let conditions: Condition[] = [];
  const nextSteps: string[] = [];
  const whatWouldChange: string[] = [];
  let redirect: Redirect | null = null;
  const lang = app.preferredLanguage ?? 'English';
  const due = (d: number) => prettyDate(addDays(d));
  const winnersText = (ids?: string[]) =>
    (ids ?? [])
      .map((u) => {
        if (u.startsWith('pair:')) {
          const p = [...pairViews.values()].find((v) => v.p.id === u.slice(5))?.p;
          return p ? `${p.op.app.id} + ${p.inv.app.id} as a pair (${p.combined})` : null;
        }
        const w = byUid.get(u);
        return w ? `${w.app.id} (${w.combined})` : null;
      })
      .filter(Boolean)
      .join(', ');

  if (e.chatNote) {
    reasons.push(e.chatNote);
    codes.push('UPDATED_FROM_CHAT');
  }

  if (pv && pairApproved) {
    // Won a slot as a pair: operator runs the store, investor funds it.
    const p = pv.p;
    const other = pv.other.app;
    conditions = [...p.conditions, ...(f?.extraConditions ?? [])];
    decision = 'Approve with conditions';
    codes.push('PARTNERSHIP', pv.role === 'operator' ? 'PARTNERSHIP_OPERATOR' : 'PARTNERSHIP_INVESTOR', ...(f?.codes ?? []), ...conditions.map((c) => c.code));
    const pb = round1(p.econ.paybackMonths ?? 0);
    headline =
      pv.role === 'operator'
        ? `Approve with conditions, as a pair with ${other.id}: ${app.id} runs the store at ${pinLbl(p.place)}, ${other.id} funds ${lakh(p.investorFunds)}; joint partner score ${p.partner.score}, payback ${pb} months.`
        : `Approve with conditions, as a pair with ${other.id}: ${app.id} funds ${lakh(p.investorFunds)}, ${other.id} runs the store at ${pinLbl(p.place)}; joint partner score ${p.partner.score}, payback ${pb} months.`;
    reasons.push(
      `Won a slot in ${p.territory.id} (${p.territory.priority} priority, ${p.territory.openSlots} slot${p.territory.openSlots === 1 ? '' : 's'}) as a pair: ranked ${pv.partnership.rankInTerritory} with combined score ${p.combined}.`,
    );
    if (e.why.length) reasons.push(`On their own: ${lc(e.why[0])}`);
    reasons.push(...pv.partnership.covers);
    nextSteps.push(
      `Introduce ${p.op.app.id} and ${p.inv.app.id} and send the joint approval in ${lang} by ${due(2)}.`,
      `KYC, CIBIL check for both partners and the franchise agreement by ${due(7)}.`,
    );
    for (const c of conditions) nextSteps.push(`${c.owner}: ${CONDITION_TITLE[c.code] ?? c.code.toLowerCase().replace(/_/g, ' ')} by ${due(c.deadlineDays)}.`);
    whatWouldChange.push(
      `If the partnership agreement is not signed by ${due(PARTNERSHIP_RULES.agreementDays)}, the slot goes to the next in line (${nextInLine(p.op, byUid, finals) ?? 'none waiting'}) and both return to their own decisions.`,
    );
  } else if (e.status === 'hold') {
    decision = 'Hold';
    codes.push(...e.codes, ...(f?.codes ?? []));
    reasons.push(...e.why);
    if (f?.slotNote) reasons.push(f.slotNote);
    headline = `Hold: ${lc(e.why[0]).replace(/\.$/, '')}. ${e.asks.length ? `Ask: ${e.asks[0].charAt(0).toLowerCase()}${e.asks[0].slice(1)}` : ''}`.trim();
    nextSteps.push(`Expansion manager sends the request below in ${lang} by ${due(2)}.`, `Partner replies within 7 days (by ${due(7)}); the decision re-runs as soon as the answer is in.`);
    if (f?.codes.includes('SLOT_HELD')) nextSteps.push(`Slot held until ${due(HOLD_SLOT_DAYS)}; after that it goes to the next applicant.`);
    whatWouldChange.push('Sending the missing or corrected details re-runs the decision immediately.');
    if (e.p1Outlook) whatWouldChange.push(`Heads-up: on the details given so far, the other checks point to a Decline (${lc(e.p1Outlook).replace(/\.$/, '')}).`);
  } else if (e.status === 'decline') {
    decision = 'Decline';
    codes.push(...e.codes);
    reasons.push(...e.why);
    headline = `Decline: ${lc(e.why[0]).replace(/\.$/, '')}.`;
    nextSteps.push(`Send a decline note in ${lang} with the reason by ${due(3)}; the partner can reapply.`);
    if (e.codes.includes('CAPITAL_GAP_OVER_30')) whatWouldChange.push(`Showing ${lakh(e.econ.totalCashNeedLakh * 0.7)} or more in funds (within 30% of the ${lakh(e.econ.totalCashNeedLakh)} need).`);
    if (e.codes.includes('PARTNER_BELOW_BAR')) whatWouldChange.push(`A partner score of ${PARTNER_BAR.conditional}+: e.g. a site secured, a co-investor or manager named, or more funds.`);
    if (e.codes.includes('ZERO_EXPERIENCE_NOT_ELIGIBLE')) whatWouldChange.push(`Bringing in a partner or manager with retail experience, or meeting every 0-year check (score ${ZERO_EXPERIENCE_MIN_SCORE}+, full funding, a site that pays back).`);
  } else if (e.status === 'noTerritory') {
    decision = 'Waitlist';
    codes.push(...e.codes);
    reasons.push(...e.why);
    headline = `Waitlist (no territory yet): pin ${pinLbl(e.place)} is not in any territory; listed as a possible new territory.`;
    nextSteps.push(`Tell the partner by ${due(3)}: no open territory covers ${e.place.pin} yet; they are first in line if one opens.`, 'Expansion head reviews the pin in the gap list (D2).');
    whatWouldChange.push(`Adding ${e.place.pin} to a territory with an open slot, or the partner choosing a pin inside an open territory.`);
  } else if (f?.decision === 'Redirect' && f.redirect) {
    decision = 'Redirect';
    codes.push(...e.codes, ...f.codes);
    const r = f.redirect;
    redirect = { pin: r.pin, pinName: r.pinName, territoryId: r.territoryId, km: r.km, demandIndex: r.demandIndex, paybackMonths: r.paybackMonths };
    conditions = r.conditions;
    const why =
      e.status === 'blocked' ? `pin ${e.place.pin} already has store ${e.place.samePinAsStore}`
      : e.status === 'paybackFail' ? `this site does not pay back in ${PAYBACK_TARGET_MONTHS} months${e.econ.paybackMonths ? ` (${round1(e.econ.paybackMonths)} months)` : ''}`
      : f.codes.includes('PIN_TAKEN_IN_RUN') ? `pin ${e.place.pin} went to a higher-scoring applicant`
      : `${e.place.territoryId}'s slots went to higher-scoring applicants`;
    headline = `Redirect to ${r.pin} ${r.pinName} (${km(r.km)} away, ${r.territoryId}): ${why}; the new pin pays back in ${round1(r.paybackMonths ?? 0)} months.`;
    reasons.push(...e.why);
    if (f.slotNote) reasons.push(f.slotNote);
    if (f.codes.includes('SLOT_LOST')) reasons.push(`${e.place.territoryId} has ${terr?.openSlots ?? 0} slot${terr?.openSlots === 1 ? '' : 's'}; won by ${winnersText(f.winners)}. This applicant ranked ${rank.get(app.uid)} with ${e.combined}.`);
    reasons.push(
      `Offered ${r.pin} ${r.pinName} in ${r.territoryId}: demand ${round1(r.demandIndex)}/100, outside every store's overlap radius, ground-floor sales ${lakh(r.econ.monthlySalesLakh)}/month, payback ${round1(r.paybackMonths ?? 0)} months.`,
    );
    nextSteps.push(`Offer ${r.pin} ${r.pinName} to the partner in ${lang} by ${due(2)}; partner accepts within 7 days (by ${due(7)}).`, `On acceptance: find a ground-floor site of ${SPACE_SQFT.ideal}+ sq ft there within 45 days (by ${due(45)}).`);
    whatWouldChange.push(`Declining the offer moves the partner to the waitlist for ${e.place.territoryId ?? 'their area'}.`);
    if (e.status === 'paybackFail' && e.sc.floor === 'Upper') whatWouldChange.push('A ground-floor shop at the original pin would improve sales by 25% and may pass payback.');
  } else if (f?.decision === 'Decline') {
    decision = 'Decline';
    codes.push(...e.codes, ...f.codes);
    reasons.push(...e.why, `No other free pin within ${REDIRECT_MAX_KM[e.place.tier]} km in ${cityFromPin(e.place.pin ?? '') ?? e.app.city} pays back within ${PAYBACK_TARGET_MONTHS} months either.`);
    headline = `Decline (this site doesn't pay back): ${lc(e.why[0]).replace(/\.$/, '')}.`;
    nextSteps.push(`Send a decline note in ${lang} with the payback numbers by ${due(3)}; the partner can reapply with another site.`);
    whatWouldChange.push(e.sc.floor === 'Upper' || e.sc.floor === 'Not known' ? 'A ground-floor shop (sales assumption +25% vs upper floor) at a pin with higher demand.' : 'A site in a higher-demand pin inside an open territory.');
  } else if (f && (f.decision === 'Approve' || f.decision === 'Approve with conditions')) {
    conditions = [...e.conditions, ...f.extraConditions];
    decision = conditions.length === 0 ? 'Approve' : 'Approve with conditions';
    codes.push(...e.codes, ...f.codes, ...conditions.map((c) => c.code));
    headline =
      decision === 'Approve'
        ? `Approve: partner ${e.partner.score}, place ${e.place.placeScore} at ${pinLbl(e.place)}, payback ${round1(e.econ.paybackMonths ?? 0)} months; won a ${e.place.territoryId} slot.`
        : `Approve with ${conditions.length} condition${conditions.length > 1 ? 's' : ''}: partner ${e.partner.score} at ${pinLbl(e.place)}, payback ${round1(e.econ.paybackMonths ?? 0)} months; ${conditions.map((c) => c.code.toLowerCase().replace(/_/g, ' ')).join(' + ')}.`;
    reasons.push(`Won a slot in ${e.place.territoryId} (${terr?.priority} priority, ${terr?.openSlots} slot${terr?.openSlots === 1 ? '' : 's'}): ranked ${rank.get(app.uid)} with combined score ${e.combined}.`);
    nextSteps.push(`Send the approval${conditions.length ? ' and conditions' : ''} in ${lang} by ${due(2)}.`, `KYC, CIBIL check and franchise agreement by ${due(7)}.`);
    for (const c of conditions) nextSteps.push(`${c.owner}: ${CONDITION_TITLE[c.code] ?? c.code.toLowerCase().replace(/_/g, ' ')} by ${due(c.deadlineDays)}.`);
    if (conditions.length) whatWouldChange.push(`Missing a condition deadline moves the slot to the next applicant (${nextInLine(e, byUid, finals) ?? 'none waiting'}).`);
  } else {
    // waitlists: slot lost, pin taken, zero slots, not ready, blocked with no redirect
    decision = 'Waitlist';
    codes.push(...e.codes, ...(f?.codes ?? []));
    reasons.push(...e.why);
    const c = f?.codes ?? [];
    if (e.status === 'notReady') {
      headline = `Waitlist (not ready yet): ${lc(e.why[0]).replace(/\.$/, '')}.`;
      conditions = e.conditions;
      whatWouldChange.push(`Clearing conditions until ${MAX_CONDITIONS_FOR_APPROVAL} or fewer remain (e.g. ${e.conditions.slice(0, 2).map((x) => x.code.toLowerCase().replace(/_/g, ' ')).join(', ')}).`);
      nextSteps.push(`Share the open conditions with the partner in ${lang} by ${due(3)}; re-check in 30 days (${due(30)}).`);
    } else if (c.includes('ZERO_SLOTS')) {
      const pos = waitPos(e, byUid, finals);
      headline = `Waitlist: ${e.place.territoryId} has 0 open slots; partner score ${e.partner.score}, ${ordinal(pos)} in line if a slot opens.`;
      reasons.push(f?.slotNote ?? '');
      whatWouldChange.push(`The expansion head opening a slot in ${e.place.territoryId}.`);
      nextSteps.push(`Tell the partner by ${due(3)}: viable, waiting for a slot in ${e.place.territoryId}.`);
    } else if (c.includes('PAYBACK_FAIL_ALT_PIN_NO_SLOT')) {
      headline = `Waitlist: this site doesn't pay back (${e.econ.paybackMonths === null ? 'no profit' : `${round1(e.econ.paybackMonths)} months`}), and the pins that would are in territories with no free slot.`;
      reasons.push(f?.slotNote ?? '');
      whatWouldChange.push('A slot opening in a territory where a ground-floor site pays back, or a ground-floor shop in a higher-demand pin.');
      nextSteps.push(`Tell the partner by ${due(3)}: this site fails payback; we will offer a better pin when a slot opens.`);
    } else if (c.includes('PAYBACK_FAIL_ALT_PIN_NOT_READY')) {
      headline = `Waitlist: this site doesn't pay back (${e.econ.paybackMonths === null ? 'no profit' : `${round1(e.econ.paybackMonths)} months`}), and the free pin that would comes with too many conditions.`;
      reasons.push(f?.slotNote ?? '');
      whatWouldChange.push('Clearing a condition (e.g. funding proof or a confirmed site), or a ground-floor shop in a higher-demand pin.');
      nextSteps.push(`Tell the partner by ${due(3)}: this site fails payback; share what would make a nearby pin work.`);
    } else if (e.status === 'blocked') {
      headline = `Waitlist: pin ${e.place.pin} already has store ${e.place.samePinAsStore}, and ${f?.slotNote ?? 'no free pin nearby passes the checks'}.`;
      if (f?.noOffer) reasons.push(f.noOffer);
      whatWouldChange.push('A slot opening in a nearby territory, or the partner proposing another pin.');
      nextSteps.push(`Ask the partner in ${lang} by ${due(3)} whether they can consider another area.`);
    } else {
      const lost = c.includes('SLOT_LOST')
        ? `${e.place.territoryId}'s ${terr?.openSlots} slot${terr?.openSlots === 1 ? '' : 's'} went to ${winnersText(f?.winners)}`
        : lc(f?.slotNote ?? 'a stronger applicant took the slot').replace(/\.$/, '');
      headline = `Waitlist: ${lost}; ranked ${rank.get(app.uid)} with combined score ${e.combined}.`;
      reasons.push(c.includes('SLOT_LOST') ? `${e.place.territoryId} (${terr?.priority} priority) has ${terr?.openSlots} slot${terr?.openSlots === 1 ? '' : 's'}; this applicant ranked ${rank.get(app.uid)} with combined score ${e.combined}.` : (f?.slotNote ?? ''));
      if (c.includes('NO_FREE_PIN_NEARBY') && f?.noOffer) reasons.push(f.noOffer);
      whatWouldChange.push(`A winner missing a condition deadline, or a new slot in ${e.place.territoryId}: this applicant is ${ordinal(waitPos(e, byUid, finals))} in line.`);
      nextSteps.push(`Tell the partner by ${due(3)}: viable but waitlisted; position is kept for 90 days (to ${due(90)}).`);
    }
  }

  // suggested partnership (did not win a slot as a pair): individual decision stays, the pairing is stated plainly
  if (pv && !pairApproved && (decision === 'Waitlist' || decision === 'Decline')) {
    const o = pv.other.app;
    const oYears = o.experienceYears ?? 0;
    const who =
      pv.role === 'operator'
        ? `${lakh(o.investmentLakh ?? 0)}, ${yearsText(oYears)}`
        : `${yearsText(oYears)}${o.currentBusiness.trim() ? ` (${o.currentBusiness.trim()})` : ''}, ${lakh(o.investmentLakh ?? 0)}`;
    const rest = pv.partnership.outcome.replace(/^Suggested pair: would /, '');
    reasons.push(`Suggested partner: ${o.id} ${o.name} (${who}). As a pair you would ${rest}`);
    codes.push('PARTNERSHIP_SUGGESTED');
    whatWouldChange.push(
      pv.role === 'operator'
        ? `Partnering with ${o.id}: ${o.id} funds ${lakh(pv.p.investorFunds)} and ${app.id} runs the store at ${pinLbl(pv.p.place)} (joint partner score ${pv.p.partner.score}, payback ${round1(pv.p.econ.paybackMonths ?? 0)} months).`
        : `Partnering with ${o.id}: ${o.id} runs the store at ${pinLbl(pv.p.place)} and ${app.id} funds ${lakh(pv.p.investorFunds)} (joint partner score ${pv.p.partner.score}, payback ${round1(pv.p.econ.paybackMonths ?? 0)} months).`,
    );
    nextSteps.push(`Introduce ${pv.p.op.app.id} and ${pv.p.inv.app.id} by ${due(7)} to discuss a partnership; the pair is first considered when a ${pv.p.territory.id} slot opens.`);
  }

  // always show the three numbers lines
  if (pv && pairApproved) reasons.push(partnerLine(pv.p.partner, true), placeLine(stripPlace(pv.p.place)), moneyLine(pv.p.econ, pv.p.capacity, pv.p.econFloor, pv.p.hasSite, 'combined'));
  else reasons.push(partnerLine(e.partner), placeLine(e.place), moneyLine(e.econ, e.app.investmentLakh, e.econFloor, e.hasSite));
  for (const fl of e.flags) if (fl.severity === 'info' && fl.code.endsWith('PARSED_FROM_TEXT')) reasons.push(`Note: ${fl.message}`);

  // preparation + launch plan
  let launchPlan: Result['launchPlan'] = null;
  const shadow = shadowStoreFor(e, geo);
  if (pv && pairApproved && pv.launchPlan) {
    launchPlan = pv.launchPlan;
    if (launchPlan.festivalNote) reasons.push(launchPlan.festivalNote);
    nextSteps.push(`Target opening ${prettyDate(launchPlan.targetOpenDate)} (${launchPlan.totalDays}-day plan).`);
  } else if (decision === 'Approve' || decision === 'Approve with conditions') {
    launchPlan = buildLaunchPlan({
      app, hasSite: e.hasSite, floor: e.sc.floor, sizeSqft: e.sc.size, zeroExperience: e.zeroExp, partner: e.partner,
      sitePinLabel: pinLbl(e.place), shadowStore: shadow, capitalCondition: conditions.some((c) => c.code.startsWith('CAPITAL') || c.code === 'BUFFER_SHORT'),
    });
    if (launchPlan.festivalNote) reasons.push(launchPlan.festivalNote);
    nextSteps.push(`Target opening ${prettyDate(launchPlan.targetOpenDate)} (${launchPlan.totalDays}-day plan).`);
  }
  const preparation = launchPlan
    ? launchPlan.training
    : prepFor(e, decision, shadow, lang);

  const asks = e.asks;
  // An approved pair shows the joint numbers (joint partner score, the site's place and P&L with combined capacity).
  const jp = pv && pairApproved ? pv.p : null;
  return {
    uid: app.uid,
    partnership: pv
      ? { id: pv.p.id, role: pv.role, withUid: pv.other.app.uid, withAppId: pv.other.app.id, withName: pv.other.app.name, status: pv.partnership.status }
      : null,
    appId: app.id,
    name: app.name,
    city: String(app.city),
    pin: app.pin,
    decision,
    headline,
    reasons: reasons.filter(Boolean),
    reasonCodes: [...new Set(codes)],
    nextSteps,
    preparation,
    whatWouldChange,
    asks,
    conditions,
    partnerScore: jp ? jp.partner.score : e.partner.score,
    partnerBreakdown: jp ? jp.partner.items : e.partner.items,
    place: stripPlace(jp ? jp.place : e.place),
    economics: jp ? jp.econ : e.econ,
    readiness: jp ? jp.readiness : e.readiness,
    combinedScore: jp ? jp.combined : e.combined,
    territoryId: e.place.territoryId,
    rankInTerritory: jp ? (pv!.partnership.rankInTerritory ?? null) : (rank.get(app.uid) ?? null),
    redirect,
    launchPlan,
    flags: e.flags,
  };
}

/** Position among viable waitlisted applicants in the same territory (those who only lack a slot). */
function waitPos(e: Eval, byUid: Map<string, Eval>, finals: Map<string, Final>): number {
  const waiting = [...byUid.values()]
    .filter((o) => o.place.territoryId === e.place.territoryId && o.status === 'eligible' && finals.get(o.app.uid)?.decision === 'Waitlist')
    .sort((a, b) => tieBreak(a, b));
  return Math.max(1, waiting.findIndex((o) => o.app.uid === e.app.uid) + 1);
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** The viable waitlisted applicant in the same territory who would take the slot next. */
function nextInLine(e: Eval, byUid: Map<string, Eval>, finals: Map<string, Final>): string | null {
  const same = [...byUid.values()]
    .filter((o) => o.place.territoryId === e.place.territoryId && o.status === 'eligible' && o.app.uid !== e.app.uid && finals.get(o.app.uid)?.decision === 'Waitlist')
    .sort((a, b) => tieBreak(a, b));
  return same[0]?.app.id ?? null;
}

function stripPlace(p: ReturnType<typeof placeFor>): PlaceInfo {
  const { tier: _t, territory: _r, ...rest } = p;
  void _t;
  void _r;
  return rest;
}

function shadowStoreFor(e: Eval, geo: Geo): { id: string; area: string; km: number } | null {
  const info = geo.pinInfo(e.place.pin);
  const city = (e.place.pin && cityFromPin(e.place.pin)) || e.app.city;
  const pt = info ?? null;
  const sameCity = geo.stores.filter((s) => s.city === city && s.pin !== e.place.pin);
  const pool = sameCity.length ? sameCity : geo.stores;
  if (!pt) {
    const s = pool[0];
    return s ? { id: s.id, area: s.area, km: 0 } : null;
  }
  const n = nearestStore(pt, pool);
  return n ? { id: n.store.id, area: n.store.area, km: round1(Math.max(0.1, n.km)) } : null;
}

function prepFor(e: Eval, d: Decision, shadow: { id: string; area: string; km: number } | null, lang: string): string[] {
  if (d === 'Decline') return [`No preparation plan: declined. Reapply with the gaps fixed; guidance sent in ${lang}.`];
  const out: string[] = [];
  if (d === 'Redirect') out.push('Full launch plan starts once the partner accepts the redirect pin and secures a site.');
  else if (d === 'Hold') out.push('Launch plan is drafted once the missing details arrive.');
  else out.push('Launch plan is drafted when a slot opens.');
  if (e.zeroExp) out.push('Will need a store manager with 2+ years of retail experience and 4 weeks of training.');
  if (e.partner.relevance !== 'same') out.push('Will need the eyewear category course (frames, lenses, prescriptions).');
  if (shadow) out.push(`Can start shadowing ${shadow.id} ${shadow.area}${shadow.km ? ` (${round1(shadow.km)} km)` : ''} early to get ready.`);
  out.push(`Training language: ${lang}.`);
  return out;
}

// ---------------------------------------------------------------- territories + gaps
function territoryStatus(t: Territory, results: Result[], geo: Geo, partnerships: Partnership[]): TerritoryStatus {
  const inT = results.filter((r) => r.territoryId === t.id);
  const pairById = new Map(partnerships.map((p) => [p.id, p]));
  const pairMembers = new Set<string>(); // investors of allocated pairs: the pair is listed once, under the operator's uid
  const filled = results
    .filter(
      (r) =>
        (r.territoryId === t.id && (r.decision === 'Approve' || r.decision === 'Approve with conditions' || (r.decision === 'Hold' && r.reasonCodes.includes('SLOT_HELD')))) ||
        (r.decision === 'Redirect' && r.redirect?.territoryId === t.id),
    )
    .filter((r) => {
      if (r.partnership?.status === 'allocated' && r.partnership.role === 'investor') {
        pairMembers.add(r.uid);
        return false;
      }
      return true;
    })
    .map((r) => {
      const p = r.partnership?.status === 'allocated' ? pairById.get(r.partnership.id) : undefined;
      if (p) return { uid: r.uid, appId: `${p.operatorAppId} + ${p.investorAppId}`, name: `${p.operatorName} + ${p.investorName}`, pin: p.pin, decision: r.decision, combinedScore: r.combinedScore };
      return { uid: r.uid, appId: r.appId, name: r.name, pin: r.decision === 'Redirect' ? r.redirect!.pin : (r.pin ?? ''), decision: r.decision, combinedScore: r.combinedScore };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore || a.appId.localeCompare(b.appId));
  const filledSet = new Set([...filled.map((f) => f.uid), ...pairMembers]);
  const contenders = inT
    .filter((r) => !filledSet.has(r.uid))
    .sort((a, b) => b.combinedScore - a.combinedScore || a.appId.localeCompare(b.appId))
    .map((r) => ({ uid: r.uid, appId: r.appId, name: r.name, decision: r.decision, combinedScore: r.combinedScore, note: r.headline }));
  const others = inT.filter((r) => !filledSet.has(r.uid));
  const tally = (['Waitlist', 'Redirect', 'Hold', 'Decline'] as Decision[])
    .map((d) => [d, others.filter((r) => r.decision === d).length] as const)
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${n} ${d === 'Waitlist' ? 'waitlisted' : d === 'Redirect' ? 'redirected elsewhere' : d === 'Hold' ? 'on hold' : 'declined'}`);
  const othersText = tally.length ? ` Others: ${tally.join(', ')}.` : '';
  let reason: string;
  if (t.openSlots === 0) reason = `No open slots, so nobody can be approved here.${othersText}`;
  else if (!inT.length && !filled.length) reason = `${t.openSlots} open slot${t.openSlots === 1 ? '' : 's'} and no applicants: target local retailers here.`;
  else {
    const byId = new Map(results.map((r) => [r.uid, r]));
    const why = (r: Result) =>
      r.reasonCodes.includes('PIN_TAKEN_IN_RUN') ? 'after a pin clash'
      : r.reasonCodes.includes('SAME_PIN_EXISTING_STORE') ? `because ${r.pin} already has a store`
      : r.reasonCodes.includes('PAYBACK_FAIL') ? `because ${r.pin} fails payback`
      : 'after losing the slot at their own pin';
    const won = filled.filter((f) => f.decision !== 'Redirect');
    const parts = won.map((f) => `${f.appId}${f.appId.includes(' + ') ? ' as a pair' : ''} (${f.combinedScore}${f.decision === 'Hold' ? ', slot held' : ''})`);
    const moved = filled
      .filter((f) => f.decision === 'Redirect')
      .map((f) => {
        const r = byId.get(f.uid)!;
        return `${f.appId} (partner ${r.partnerScore}) redirected from ${r.pin ?? '?'} to ${f.pin} ${why(r)}`;
      });
    const free = t.openSlots - filled.length;
    reason = `${t.openSlots} slot${t.openSlots === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')} won on combined score` : ''}${moved.length ? `${parts.length ? '; ' : ': '}${moved.join(', ')}` : ''}.${free > 0 ? ` ${free} still open: no other applicant passed every check.` : ''}${othersText}`;
  }
  const demands = t.pins.map((p) => demandIndexFor(p, geo.ctx).index);
  const avgDemand = demands.length ? demands.reduce((s, d) => s + d, 0) / demands.length : 0;
  const strongLeft = inT.filter((r) => !filledSet.has(r.uid) && r.partnerScore >= PARTNER_BAR.strong && r.decision !== 'Decline').length;
  const suggestRaisePriority = t.priority !== 'High' && avgDemand >= 55 && strongLeft >= 1;
  if (suggestRaisePriority) reason += ` Consider raising priority or slots: average demand ${round1(avgDemand)}/100 and ${strongLeft} strong partner${strongLeft === 1 ? '' : 's'} waiting.`;
  return { id: t.id, city: String(t.city), tier: t.tier, priority: t.priority, openSlots: t.openSlots, filled, contenders, reason, suggestRaisePriority };
}

function buildGaps(parse: ParseResult, results: Result[], geo: Geo, ctx: EngineContext, reserved: Map<string, string>, partnerships: Partnership[]): GapPin[] {
  const applicantsByPin = new Map<string, number>();
  for (const a of parse.applications) if (a.pin) applicantsByPin.set(a.pin, (applicantsByPin.get(a.pin) ?? 0) + 1);
  const approvedByPin = new Set(
    results.filter((r) => (r.decision === 'Approve' || r.decision === 'Approve with conditions') && r.partnership?.status !== 'allocated').map((r) => r.pin),
  );
  for (const p of partnerships) if (p.status === 'allocated') approvedByPin.add(p.pin);
  const pins = new Set<string>([...ctx.pins.map((p) => p.pin), ...parse.territories.flatMap((t) => t.pins)]);
  const out: (GapPin & { score: number })[] = [];
  for (const pin of pins) {
    if (geo.storePins.has(pin) || reserved.has(pin)) continue;
    const info = geo.pinInfo(pin);
    if (!info) continue;
    const pl = placeFor(pin, info.city, geo);
    const nearKm = pl.nearestStore?.km ?? 0;
    if (pl.insideOverlapRadius) continue;
    const n = applicantsByPin.get(pin) ?? 0;
    const d = demandIndexFor(pin, ctx);
    let note: string;
    if (!pl.territoryId) note = n ? `${n} applicant${n === 1 ? '' : 's'} here but no territory covers this pin: consider opening one.` : 'Demand with no territory covering it: consider opening one.';
    else if (!n) note = `In ${pl.territoryId}, but no one applied here: target local retailers.`;
    else if (!approvedByPin.has(pin)) note = `${n} applicant${n === 1 ? '' : 's'} in ${pl.territoryId}, none approved at this pin yet.`;
    else note = `${n} applicant${n === 1 ? '' : 's'} in ${pl.territoryId}.`;
    out.push({
      pin, name: info.name, city: info.city, territoryId: pl.territoryId, demandIndex: round1(d.index), onlineOrders: d.onlineOrders, nearestStoreKm: round2(nearKm),
      applicants: n, note, score: placeScoreOf(pl.unservedNorm, d.index, false) + (pl.territoryId ? 0 : n ? 5 : 0),
    });
  }
  out.sort((a, b) => b.score - a.score || b.demandIndex - a.demandIndex || a.pin.localeCompare(b.pin));
  // keep the strongest 30, plus every no-territory pin that has applicants
  const top = out.slice(0, 30);
  for (const g of out.slice(30)) if (!g.territoryId && g.applicants > 0) top.push(g);
  return top.map(({ score: _s, ...g }) => {
    void _s;
    return g;
  });
}
