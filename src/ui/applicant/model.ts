// Pure helpers for the applicant page: plain-English sentences and arithmetic built only from engine data.
import type { Application, Decision, Floor, Result, Tier } from '../../types';
import { COMBINED_WEIGHTS, DEMAND_SALES_FLOOR, DEMAND_SALES_SPAN, FLOOR_FACTOR, LAUNCH_DAYS, PAYBACK_TARGET_MONTHS, TIER_ECONOMICS } from '../../config/rules';
import { relevanceOf } from '../../engine/partner';
import { fmtDate, fmtKm, fmtLakh } from '../components/ui';
import { ordinal } from '../../lib/site';

export const n1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));
export const n0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-IN'));
export const months = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} months`);
export const lakh2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `₹${v.toFixed(2)} L`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Drop the "Decision:" prefix the engine puts on its headlines. */
export function stripPrefix(headline: string, decision: Decision): string {
  const s = headline.replace(new RegExp(`^${decision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-–]\\s*`, 'i'), '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const pinLabel = (pin: string | null, name: string) => (pin ? (name && name !== `Pin ${pin}` ? `${pin} ${name}` : pin) : 'an unreadable pin');

/** One plain sentence: what happens to this applicant. */
export function outcomeSentence(r: Result, slots: number | null): string {
  const terr = r.territoryId ?? 'no territory';
  const pb = r.economics.paybackMonths;
  switch (r.decision) {
    case 'Approve':
      return `Approved for ${terr} at ${pinLabel(r.place.pin, r.place.pinName)}. Strong partner; the store pays back in ${months(pb)} (target ${PAYBACK_TARGET_MONTHS}).`;
    case 'Approve with conditions': {
      const c = r.conditions;
      if (!c.length) return `Approved for ${terr} with conditions. ${stripPrefix(r.headline, r.decision)}`;
      return `Approved for ${terr} once ${c.length === 1 ? 'one condition is' : `${c.length} conditions are`} met: ${lowerFirst(c[0].text)}${c.length > 1 ? ' (and one more below)' : ''}.`;
    }
    case 'Redirect':
      if (r.redirect)
        return `Good partner, but ${pinLabel(r.pin, r.place.pinName)} is not available. Offer ${pinLabel(r.redirect.pin, r.redirect.pinName)} in ${r.redirect.territoryId}, ${fmtKm(r.redirect.km)} away.`;
      return stripPrefix(r.headline, r.decision);
    case 'Waitlist':
      if (r.reasonCodes.includes('SLOT_LOST')) {
        const queue = r.rankInTerritory !== null && slots ? Math.max(1, r.rankInTerritory - slots) : null;
        const line = queue ? `${ordinal(queue)} in line if a slot opens (rank ${r.rankInTerritory}).` : 'In line if a slot opens.';
        return `Viable, but ${terr}'s ${slots ?? ''} slot${slots === 1 ? '' : 's'} went to higher-scoring applicants. ${line}`.replace('  ', ' ');
      }
      return stripPrefix(r.headline, r.decision);
    case 'Hold':
      if (r.asks.length) return `On hold until they send: ${r.asks.map(lowerFirst).map((a) => a.replace(/\.$/, '')).join('; ')}.`;
      return stripPrefix(r.headline, r.decision);
    case 'Decline':
      return `Declined. ${stripPrefix(r.headline, r.decision)}`;
  }
}

function lowerFirst(s: string) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** The single action an operator takes next, and the message it copies. */
export function primaryAction(r: Result, app: Application | undefined): { label: string; message: string; note: string } {
  const lang = app?.preferredLanguage ?? null;
  const first = r.name.split(' ')[0];
  const greet = `Dear ${first},\n\nThank you for your franchise application ${r.appId} for StoreSense Eyewear (${r.city}${r.pin ? `, ${r.pin}` : ''}).`;
  const sign = `\n\nRegards,\nExpansion team, StoreSense Eyewear`;
  const list = (xs: string[]) => xs.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const note = lang
    ? `Send in ${lang}. This draft is in English; translate before sending if needed.`
    : 'Preferred language not given: send in English and ask which language they prefer.';
  switch (r.decision) {
    case 'Hold':
      return {
        label: 'Copy request message',
        message: `${greet}\n\nTo complete the review we need the following:\n${list(r.asks.length ? r.asks : ['The missing details listed in your application.'])}\n\nOnce we have these, we will update your decision straight away.${sign}`,
        note,
      };
    case 'Approve':
    case 'Approve with conditions':
      return {
        label: 'Copy approval message',
        message: `${greet}\n\nWe are pleased to approve your application for ${r.territoryId ?? 'your area'}.${r.conditions.length ? `\n\nThe approval needs the following:\n${list(r.conditions.map((c) => `${c.text} (within ${c.deadlineDays} days)`))}` : ''}${r.nextSteps.length ? `\n\nNext steps:\n${list(r.nextSteps)}` : ''}${sign}`,
        note,
      };
    case 'Redirect':
      return {
        label: 'Copy redirect offer',
        message: `${greet}\n\nThe location you proposed is not available${r.redirect ? `, but we can offer ${pinLabel(r.redirect.pin, r.redirect.pinName)} (${fmtKm(r.redirect.km)} from your proposed site)` : ''}. Please tell us within 7 days whether you would like to go ahead there.${sign}`,
        note,
      };
    case 'Waitlist':
      return {
        label: 'Copy waitlist update',
        message: `${greet}\n\nYour application is viable, but the slots in your area are currently filled. We have placed you on the waitlist${r.rankInTerritory ? ` (position by score: ${r.rankInTerritory})` : ''} and will contact you first if a slot opens.${r.nextSteps.length ? `\n\n${r.nextSteps.join('\n')}` : ''}${sign}`,
        note,
      };
    case 'Decline':
      return {
        label: 'Copy decline note',
        message: `${greet}\n\nAfter review we are unable to approve the application at this time.\n\nMain reason: ${r.reasons[0] ?? stripPrefix(r.headline, r.decision)}${r.whatWouldChange.length ? `\n\nYou are welcome to reapply. What would change the outcome:\n${list(r.whatWouldChange)}` : '\n\nYou are welcome to reapply.'}${sign}`,
        note,
      };
  }
}

/** One-line reading of motive, from the form fields only. */
export function motiveReading(app: Application): string {
  const yrs = app.experienceYears;
  const yrsTxt = yrs === null ? 'experience not stated' : yrs === 0 ? 'no retail experience' : `${yrs} year${yrs === 1 ? '' : 's'} in retail`;
  const biz = app.currentBusiness.trim();
  const rel = relevanceOf(biz);
  if (rel.cls === 'same') return `Already in eyewear or optical retail (${yrsTxt}): the franchise would add a brand to a trade they know.`;
  if (rel.cls === 'adjacent') return `Runs related retail (${rel.keyword}, ${yrsTxt}): the franchise would add a new category to an existing shop business.`;
  if (rel.cls === 'unrelated') return `Comes from outside retail ("${biz}", ${yrsTxt}): this would be a new line of business.`;
  return yrs ? `No current business given; ${yrsTxt}.` : `No business background given and ${yrsTxt}: a first-time retailer.`;
}

/** Recover the demand index and floor the P&L used, so the arithmetic shown always matches the engine's numbers. */
export function salesFormula(tier: Tier, floorFactor: number, sales: number): { base: number; demand: number; floor: Floor } {
  const base = TIER_ECONOMICS[tier].baseSalesLakh;
  const floor = (Object.entries(FLOOR_FACTOR).find(([, f]) => Math.abs(f - floorFactor) < 1e-6)?.[0] ?? 'Not known') as Floor;
  const mult = sales / (base * floorFactor);
  const demand = ((mult - DEMAND_SALES_FLOOR) / DEMAND_SALES_SPAN) * 100;
  return { base, demand: Math.round(Math.max(0, Math.min(100, demand))), floor };
}

export const annualRoiPct = (r: Result) => (r.economics.requiredInvestmentLakh > 0 ? ((r.economics.monthlyProfitLakh * 12) / r.economics.requiredInvestmentLakh) * 100 : null);

/** Readiness = 50 for a ground/mall unit + 50 when the target launch is at least the launch plan's length. */
export function readinessParts(r: Result, app: Application | undefined) {
  const floor = app?.floor ?? null;
  const floorPts = floor === 'Ground' || floor === 'Mall unit' ? 50 : 0;
  const timePts = r.readiness - floorPts;
  const consistent = timePts === 0 || timePts === 50;
  const hasSite = (app?.spaceAvailable === 'Owned' || app?.spaceAvailable === 'Rented') && (app?.spaceSizeSqft ?? 400) >= 300;
  const planDays = hasSite ? LAUNCH_DAYS.spaceReady : LAUNCH_DAYS.noSpace;
  const mo = app?.targetLaunchMonths;
  return {
    consistent,
    rows: [
      { label: 'Site quality', evidence: floor ? `${floor} floor` : 'Floor not given', pts: consistent ? floorPts : null, max: 50 },
      {
        label: 'Timeline realistic',
        evidence: `Wants to open in ${mo ?? 6} months${mo === null || mo === undefined ? ' (assumed)' : ''}; plan needs ${planDays} days${hasSite ? '' : ' (no site yet)'}`,
        pts: consistent ? timePts : null,
        max: 50,
      },
    ],
  };
}

export function combinedArithmetic(r: Result) {
  const p = COMBINED_WEIGHTS.partner * r.partnerScore;
  const pl = COMBINED_WEIGHTS.place * r.place.placeScore;
  const rd = COMBINED_WEIGHTS.readiness * r.readiness;
  return { p, pl, rd, w: COMBINED_WEIGHTS };
}

/** Biggest reason another applicant's combined score differs from this one's. */
export function mainDifference(me: Result, other: Result, meApp?: Application, otherApp?: Application): string {
  const d = [
    { k: 'partner score', v: COMBINED_WEIGHTS.partner * (other.partnerScore - me.partnerScore), a: other.partnerScore, b: me.partnerScore },
    { k: 'place score', v: COMBINED_WEIGHTS.place * (other.place.placeScore - me.place.placeScore), a: other.place.placeScore, b: me.place.placeScore },
    { k: 'readiness', v: COMBINED_WEIGHTS.readiness * (other.readiness - me.readiness), a: other.readiness, b: me.readiness },
  ].sort((x, y) => Math.abs(y.v) - Math.abs(x.v))[0];
  if (Math.abs(d.v) < 0.05) return 'Practically the same scores';
  let detail = '';
  if (d.k === 'partner score' && meApp && otherApp) {
    if (otherApp.experienceYears !== meApp.experienceYears) detail = `; ${otherApp.experienceYears ?? '?'} vs ${meApp.experienceYears ?? '?'} yrs experience`;
    else if (otherApp.investmentLakh !== meApp.investmentLakh) detail = `; ${fmtLakh(otherApp.investmentLakh)} vs ${fmtLakh(meApp.investmentLakh)} capital`;
  }
  return `${d.v > 0 ? 'Higher' : 'Lower'} ${d.k} (${n0(d.a)} vs ${n0(d.b)})${detail}`;
}

export const dateRange = (from: string, to: string) => `${fmtDate(from)} – ${fmtDate(to)}`;
