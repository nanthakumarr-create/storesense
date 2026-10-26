// Territory helpers: area names, compass labels, nearest stores, per-applicant economics and filters.
import type { City, Decision, EngineContext, ExistingStore, Result, TerritoryStatus } from '../../types';
import { PIN_BY_CODE } from '../../data/loaders';
import { CITY_CENTRE, PRIORITY_ORDER } from '../../config/rules';
import { haversineKm } from '../../lib/geo';

export type DecisionFilter = 'all' | 'approved' | 'action' | 'waitlist' | 'declined';

export const FILTERS: { id: DecisionFilter; label: string; decisions: Decision[] | null }[] = [
  { id: 'all', label: 'All', decisions: null },
  { id: 'approved', label: 'Approved', decisions: ['Approve', 'Approve with conditions'] },
  // Buckets do not overlap: conditional approvals count once, under Approved, so the counts add up to the file.
  { id: 'action', label: 'Needs action', decisions: ['Hold', 'Redirect'] },
  { id: 'waitlist', label: 'Waitlist', decisions: ['Waitlist'] },
  { id: 'declined', label: 'Declined', decisions: ['Decline'] },
];

export function matchesFilter(r: Result, f: DecisionFilter): boolean {
  const d = FILTERS.find((x) => x.id === f)?.decisions;
  return !d || d.includes(r.decision);
}

export const sortTerritories = (list: TerritoryStatus[]) =>
  [...list].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.id.localeCompare(b.id, undefined, { numeric: true }));

const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Pin → area name ("Koramangala"), or the pin itself when the pin is not in the reference list. */
export const pinName = (pin: string) => PIN_BY_CODE[pin]?.name ?? pin;

/** Up to `n` distinct area names for a territory's pins, skipping names that only repeat the city. */
export function areaNames(pins: string[], city: string, n = 2): string[] {
  const out: string[] = [];
  for (const p of pins) {
    const name = PIN_BY_CODE[p]?.name;
    if (!name) continue;
    const clean = titleCase(name);
    if (clean.toLowerCase().startsWith(city.toLowerCase())) continue;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= n) break;
  }
  return out;
}

/** "South-East", "Central"... from the territory's pin centroid relative to the city centre. */
export function compassLabel(pins: string[], city: string): string | null {
  const pts = pins.map((p) => PIN_BY_CODE[p]).filter(Boolean);
  const centre = CITY_CENTRE[city as City];
  if (!pts.length || !centre) return null;
  const c = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
  if (haversineKm(c, centre) < 2.5) return 'Central';
  const dy = c.lat - centre.lat;
  const dx = (c.lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = north, 90 = east
  const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  return dirs[Math.round(((deg + 360) % 360) / 45) % 8];
}

export function territoryTitle(t: { id: string; city: string; pins?: string[] }, pins: string[]): string {
  const dir = compassLabel(pins, t.city);
  return `${t.id} · ${t.city}${dir ? ` ${dir}` : ''}`;
}

/** Nearest existing stores to any pin of the territory (min distance over its pins). */
export function nearestStores(pins: string[], stores: ExistingStore[], n = 2): { id: string; area: string; pin: string; km: number; inside: boolean }[] {
  const pts = pins.map((p) => PIN_BY_CODE[p]).filter(Boolean);
  if (!pts.length) return [];
  return stores
    .map((s) => {
      const sp = PIN_BY_CODE[s.pin];
      const km = sp ? Math.min(...pts.map((p) => haversineKm(p, sp))) : Infinity;
      return { id: s.id, area: sp?.name ?? s.city, pin: s.pin, km, inside: pins.includes(s.pin) };
    })
    .filter((s) => Number.isFinite(s.km))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Annual return on the required investment, from the rulebook P&L (monthly profit × 12 ÷ investment). */
export function roiPct(r: Result): number | null {
  const e = r.economics;
  if (!e.requiredInvestmentLakh) return null;
  return ((e.monthlyProfitLakh * 12) / e.requiredInvestmentLakh) * 100;
}

/** Average demand index of the territory's pins (orders for Bengaluru, proxy elsewhere). */
export function avgDemand(pins: string[], ctx: EngineContext | null): { value: number; source: 'orders' | 'proxy' } | null {
  if (!ctx || !pins.length) return null;
  const withOrders = pins.map((p) => ctx.demand[p]).filter(Boolean);
  if (withOrders.length) return { value: withOrders.reduce((s, d) => s + d.demand_index, 0) / withOrders.length, source: 'orders' };
  return null;
}

/** One-line background for the comparison table: business + experience. */
export function background(business: string | undefined, years: number | null): string {
  const b = (business ?? '').replace(/\s+/g, ' ').trim();
  const y = years === null ? 'experience not given' : years === 0 ? 'no retail experience' : `${years} yr${years === 1 ? '' : 's'} in retail`;
  if (!b) return `No business given · ${y}`;
  return `${b.length > 60 ? `${b.slice(0, 57)}…` : b} · ${y}`;
}

export const fmtNum = (v: number | null | undefined, digits = 0, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`;

/** Slot winners grouped into slots: an allocated operator + investor pair shares one slot. */
export function slotUnits(t: TerritoryStatus, byUid: Map<string, Result>): { key: string; names: string[]; uids: string[] }[] {
  const filled = new Set(t.filled.map((f) => f.uid));
  const units = new Map<string, { key: string; names: string[]; uids: string[] }>();
  for (const f of t.filled) {
    const p = byUid.get(f.uid)?.partnership;
    const key = p && p.status === 'allocated' && filled.has(p.withUid) ? p.id : f.uid;
    const u = units.get(key) ?? { key, names: [], uids: [] };
    u.names.push(f.name);
    u.uids.push(f.uid);
    units.set(key, u);
  }
  return [...units.values()];
}

export const unitLabel = (u: { names: string[] }) => (u.names.length > 1 ? `${u.names.join(' + ')} (pair)` : u.names[0]);
