// Viability check: store P&L, payback and the capital gap (rulebook "Viability check").
import type { Economics, Floor, Tier } from '../types';
import {
  BUFFER_MONTHS, CAPITAL_GAP, CONTRIBUTION_MARGIN, DEMAND_SALES_FLOOR, DEMAND_SALES_SPAN, FLOOR_FACTOR, MALL_FIXED_COST_UPLIFT,
  PAYBACK_TARGET_MONTHS, TIER_ECONOMICS,
} from '../config/rules';
import { round2 } from './util';

export function economicsFor(tier: Tier, demandIndex: number, floor: Floor | null, capacityLakh: number | null): Economics {
  const t = TIER_ECONOMICS[tier];
  const f: Floor = floor ?? 'Not known';
  const floorFactor = FLOOR_FACTOR[f];
  const fixed = t.fixedCostLakh * (f === 'Mall unit' ? 1 + MALL_FIXED_COST_UPLIFT : 1);
  const sales = t.baseSalesLakh * (DEMAND_SALES_FLOOR + (DEMAND_SALES_SPAN * demandIndex) / 100) * floorFactor;
  const profit = sales * CONTRIBUTION_MARGIN - fixed;
  const payback = profit > 0 ? t.investmentLakh / profit : null;
  const buffer = BUFFER_MONTHS * fixed;
  const need = t.investmentLakh + buffer;
  const cap = capacityLakh ?? 0;
  const gap = Math.max(0, need - cap);
  return {
    tier,
    requiredInvestmentLakh: t.investmentLakh,
    bufferLakh: round2(buffer),
    totalCashNeedLakh: round2(need),
    floorFactor,
    monthlySalesLakh: round2(sales),
    monthlyFixedCostLakh: round2(fixed),
    monthlyProfitLakh: round2(profit),
    paybackMonths: payback === null ? null : round2(payback),
    paybackPass: payback !== null && payback <= PAYBACK_TARGET_MONTHS,
    capitalGapLakh: round2(gap),
    capitalGapPct: need > 0 ? Math.round((gap / need) * 10000) / 10000 : 0,
  };
}

export type CapitalBand = 'pass' | 'condition' | 'compact' | 'decline';
export function capitalBand(e: Economics): CapitalBand {
  if (e.capitalGapLakh <= 0) return 'pass';
  if (e.capitalGapPct <= CAPITAL_GAP.conditionMax) return 'condition';
  if (e.capitalGapPct <= CAPITAL_GAP.compactMax) return 'compact';
  return 'decline';
}
