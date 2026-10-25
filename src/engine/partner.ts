// Partner layer: retail readiness index (0-100) from five weighted components.
import type { Application, Economics, ScoreItem, SpaceAvailable } from '../types';
import {
  CAPITAL_FIT_ZERO_AT, COMMITMENT, EXPERIENCE_EXTRA_PER_YEAR, EXPERIENCE_POINTS, INVOLVEMENT_KEYWORDS, INVOLVEMENT_POINTS, PARTNER_WEIGHTS,
  RELEVANCE_KEYWORDS, RELEVANCE_POINTS,
} from '../config/rules';
import { clamp, round2 } from './util';

export const MANAGER_OR_COINVESTOR = /co-?invest|optometrist|trained staff|will manage|hire a manager|store manager|manager (is|will)|brother will|father will (support|invest)|family will (support|invest)/i;
export const BANK_LOAN = /bank loan|loan/i;

export function experiencePoints(years: number | null): number {
  if (years === null) return 0;
  const y = Math.floor(years);
  if (y < EXPERIENCE_POINTS.length) return EXPERIENCE_POINTS[Math.max(0, y)];
  return Math.min(100, EXPERIENCE_POINTS[EXPERIENCE_POINTS.length - 1] + EXPERIENCE_EXTRA_PER_YEAR * (y - (EXPERIENCE_POINTS.length - 1)));
}

export type RelevanceClass = 'same' | 'adjacent' | 'unrelated' | 'blank';
export function relevanceOf(business: string): { cls: RelevanceClass; keyword: string | null } {
  const s = ` ${business.toLowerCase()} `;
  if (!business.trim()) return { cls: 'blank', keyword: null };
  for (const k of RELEVANCE_KEYWORDS.same) if (s.includes(k)) return { cls: 'same', keyword: k };
  for (const k of RELEVANCE_KEYWORDS.adjacent) if (s.includes(k)) return { cls: 'adjacent', keyword: k };
  return { cls: 'unrelated', keyword: null };
}

export function involvementOf(app: Application): { pts: number; hit: string | null; level: 'high' | 'neutral' | 'low' } {
  const s = ` ${`${app.notes} ${app.currentBusiness}`.toLowerCase()} `;
  if (!app.notes.trim() && !app.currentBusiness.trim()) return { pts: INVOLVEMENT_POINTS.neutral, hit: null, level: 'neutral' };
  const low = INVOLVEMENT_KEYWORDS.low.find((k) => s.includes(k));
  const high = INVOLVEMENT_KEYWORDS.high.find((k) => s.includes(k));
  if (low && high) return { pts: INVOLVEMENT_POINTS.neutral, hit: `${high.trim()} / ${low.trim()}`, level: 'neutral' };
  if (low) return { pts: INVOLVEMENT_POINTS.low, hit: low.trim().replace(/,$/, ''), level: 'low' };
  if (high) return { pts: INVOLVEMENT_POINTS.high, hit: high.trim(), level: 'high' };
  return { pts: INVOLVEMENT_POINTS.neutral, hit: null, level: 'neutral' };
}

export function capitalFitPoints(capacity: number | null, need: number): number {
  if (capacity === null || need <= 0) return 0;
  const r = capacity / need;
  if (r >= 1) return 100;
  return round2(clamp(((r - CAPITAL_FIT_ZERO_AT) / (1 - CAPITAL_FIT_ZERO_AT)) * 100));
}

export interface PartnerScore {
  score: number;
  items: ScoreItem[];
  relevance: RelevanceClass;
  involvement: 'high' | 'neutral' | 'low';
  hasManagerOrCoInvestor: boolean;
}

export function partnerScore(app: Application, space: SpaceAvailable | null, econ: Economics): PartnerScore {
  const yrs = app.experienceYears;
  const exp = experiencePoints(yrs);
  const rel = relevanceOf(app.currentBusiness);
  const relPts = RELEVANCE_POINTS[rel.cls];
  const spacePts = space ? COMMITMENT.spacePoints[space] : COMMITMENT.spacePoints['Not yet identified'];
  const mgr = MANAGER_OR_COINVESTOR.test(app.notes);
  const commit = COMMITMENT.spaceWeight * spacePts + COMMITMENT.managerOrCoInvestorWeight * (mgr ? 100 : 0);
  const cap = capitalFitPoints(app.investmentLakh, econ.totalCashNeedLakh);
  const inv = involvementOf(app);

  const relNote =
    rel.cls === 'same' ? `"${app.currentBusiness}" is the same category (eyewear/optical)`
    : rel.cls === 'adjacent' ? `"${app.currentBusiness}" is adjacent retail (${rel.keyword})`
    : rel.cls === 'blank' ? 'No current business given (neutral)'
    : `"${app.currentBusiness}" is not retail-related`;
  const items: ScoreItem[] = [
    { label: 'Experience', weight: PARTNER_WEIGHTS.experience, score: exp, note: yrs === null ? 'Years not given' : `${yrs} year${yrs === 1 ? '' : 's'} running a shop` },
    { label: 'Category relevance', weight: PARTNER_WEIGHTS.relevance, score: relPts, note: relNote },
    {
      label: 'Commitment',
      weight: PARTNER_WEIGHTS.commitment,
      score: round2(commit),
      note: `Space: ${space ?? 'not given'} (${spacePts}); ${mgr ? 'manager / co-investor / trained staff named in notes' : 'no manager or co-investor named'}`,
    },
    {
      label: 'Capital fit',
      weight: PARTNER_WEIGHTS.capitalFit,
      score: cap,
      note: app.investmentLakh === null ? 'Investment not given' : `₹${app.investmentLakh} L available vs ₹${econ.totalCashNeedLakh} L total cash need`,
    },
    {
      label: 'Owner involvement',
      weight: PARTNER_WEIGHTS.involvement,
      score: inv.pts,
      note: inv.level === 'high' ? `Hands-on ("${inv.hit}")` : inv.level === 'low' ? `Hands-off ("${inv.hit}")` : inv.hit ? `Mixed signals ("${inv.hit}")` : 'Nothing in the notes either way',
    },
  ];
  const score = round2(items.reduce((s, i) => s + i.weight * i.score, 0));
  return { score, items, relevance: rel.cls, involvement: inv.level, hasManagerOrCoInvestor: mgr };
}
