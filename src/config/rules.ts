// Every threshold and weight the engine uses. All numbers are ASSUMPTIONS to be checked against
// the brand's existing stores in the pilot (this file is the assumptions slide).
import type { City, Floor, Priority, Tier } from '../types';

/** All date maths uses this fixed date so the same file always gives the same answer. */
export const AS_OF_DATE = '2026-10-25';

export const CITY_TIER: Record<City, Tier> = {
  Bengaluru: 'Tier 1',
  Mysuru: 'Tier 2',
  Mangaluru: 'Tier 2',
  'Hubballi-Dharwad': 'Tier 2',
  Belagavi: 'Tier 2',
  Tumakuru: 'Tier 3',
  Davanagere: 'Tier 3',
};
export const CITY_PIN_PREFIX: Record<City, string> = {
  Bengaluru: '560',
  Mysuru: '570',
  Mangaluru: '575',
  'Hubballi-Dharwad': '580',
  Belagavi: '590',
  Tumakuru: '572',
  Davanagere: '577',
};
export const CITY_CENTRE: Record<City, { lat: number; lng: number }> = {
  Bengaluru: { lat: 12.9794, lng: 77.5907 },
  Mysuru: { lat: 12.3052, lng: 76.6552 },
  Mangaluru: { lat: 12.8698, lng: 74.843 },
  'Hubballi-Dharwad': { lat: 15.3647, lng: 75.124 },
  Belagavi: { lat: 15.8497, lng: 74.4977 },
  Tumakuru: { lat: 13.3409, lng: 77.101 },
  Davanagere: { lat: 14.4644, lng: 75.9218 },
};
export const LANGUAGES = ['Kannada', 'English', 'Hindi'] as const;
export const DEFAULT_LANGUAGE = 'English';

// ---------- Place (demand + overlap) ----------
/** Same pin as an existing or approved store is a hard block. Inside this radius is a catchment-check condition. */
export const OVERLAP_RADIUS_KM: Record<Tier, number> = { 'Tier 1': 2, 'Tier 2': 3, 'Tier 3': 5 };
/** Demand proxy for pins without order data: tier base + core-zone bonus. */
export const DEMAND_PROXY_BASE: Record<Tier, number> = { 'Tier 1': 70, 'Tier 2': 55, 'Tier 3': 45 };
export const DEMAND_PROXY_CORE_BONUS = 10;
export const PLACE_WEIGHTS = { unserved: 0.6, demand: 0.4 };
/** Points taken off the place score when inside another store's overlap radius. */
export const OVERLAP_PLACE_PENALTY = 25;

// ---------- Viability (store P&L and payback) ----------
export const TIER_ECONOMICS: Record<Tier, { investmentLakh: number; baseSalesLakh: number; fixedCostLakh: number }> = {
  'Tier 1': { investmentLakh: 35, baseSalesLakh: 9.5, fixedCostLakh: 1.9 },
  'Tier 2': { investmentLakh: 22, baseSalesLakh: 6.0, fixedCostLakh: 1.2 },
  'Tier 3': { investmentLakh: 15, baseSalesLakh: 4.2, fixedCostLakh: 0.84 },
};
/** Contribution margin after product cost and variable costs (≈45% gross − ≈10% variable). */
export const CONTRIBUTION_MARGIN = 0.35;
/** Partner must keep this many months of fixed cost as a cash buffer on top of the investment. */
export const BUFFER_MONTHS = 3;
/** sales = baseSales × (DEMAND_SALES_FLOOR + DEMAND_SALES_SPAN × demand/100) × floorFactor */
export const DEMAND_SALES_FLOOR = 0.7;
export const DEMAND_SALES_SPAN = 0.6;
export const FLOOR_FACTOR: Record<Floor, number> = { Ground: 1.0, 'Mall unit': 1.05, Upper: 0.8, 'Not known': 0.9 };
/** Mall units carry higher rent and CAM charges. */
export const MALL_FIXED_COST_UPLIFT = 0.25;
export const PAYBACK_TARGET_MONTHS = 30;
/** Capital gap vs total cash need: ≤15% → condition; 15–30% → condition only if a compact format fits, else Waitlist; >30% → Decline. */
export const CAPITAL_GAP = { conditionMax: 0.15, compactMax: 0.3 };
export const SPACE_SQFT = { ideal: 400, compactMin: 300 };

// ---------- Partner (retail readiness index, weights sum to 1) ----------
export const PARTNER_WEIGHTS = { experience: 0.35, relevance: 0.2, commitment: 0.2, capitalFit: 0.15, involvement: 0.1 };
/** Experience score by years: 0→0, 1→50, 2→60, 3→70, 4→85, then +3 per year, capped at 100. */
export const EXPERIENCE_POINTS = [0, 50, 60, 70, 85];
export const EXPERIENCE_EXTRA_PER_YEAR = 3;
export const RELEVANCE_KEYWORDS = {
  same: ['optic', 'optical', 'eyewear', 'spectacle', 'optometr', 'eye clinic', 'eye hospital', 'lens', 'sunglass', 'watch', 'eye'],
  adjacent: ['footwear', 'shoe', 'apparel', 'garment', 'clothes', 'boutique', 'fashion', 'jewel', 'accessor', 'mobile', 'pharma', 'medical', 'chemist', 'electronic', 'kirana', 'supermarket', 'provision', 'general store', 'retail', 'franchise', 'showroom', 'gift', 'bag'],
};
export const RELEVANCE_POINTS = { same: 100, adjacent: 70, unrelated: 25, blank: 40 };
export const COMMITMENT = { spacePoints: { Owned: 100, Rented: 85, 'Not yet identified': 30 }, spaceWeight: 0.6, managerOrCoInvestorWeight: 0.4 };
/** Capital fit: 100 if capacity ≥ total need, falling linearly to 0 at this share of total need. */
export const CAPITAL_FIT_ZERO_AT = 0.7;
export const INVOLVEMENT_KEYWORDS = {
  high: ['myself', 'full-time', 'full time', 'family', 'wife', 'husband', 'local', 'immediately', 'own the building'],
  low: ['passive', 'nri', 'dubai', ' us,', 'weekend', 'side business', 'relative will run', 'will hire a manager'],
};
export const INVOLVEMENT_POINTS = { high: 90, neutral: 50, low: 20 };
export const PARTNER_BAR = { strong: 70, conditional: 55 };
/** 0-year applicants can still be approved with conditions if they clear this score and every other gate. */
export const ZERO_EXPERIENCE_MIN_SCORE = 45;

// ---------- Allocation ----------
export const COMBINED_WEIGHTS = { partner: 0.5, place: 0.3, readiness: 0.2 };
export const PRIORITY_ORDER: Priority[] = ['High', 'Medium', 'Low'];
/** More conditions than this → Waitlist (not ready yet). */
export const MAX_CONDITIONS_FOR_APPROVAL = 2;
export const HOLD_SLOT_DAYS = 14;

// ---------- Launch plan ----------
export const LAUNCH_DAYS = { spaceReady: 70, noSpace: 110 };
export const FESTIVALS = [
  { name: 'Diwali', date: '2026-11-08' },
  { name: 'Sankranti', date: '2027-01-14' },
  { name: 'Ugadi', date: '2027-03-29' },
];
