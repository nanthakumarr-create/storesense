// Map-only data and helpers: pin boundary shapes and order flows (both fetched once, lazily),
// the bundled new-store potential table, colour scales and small geometry helpers.
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import potentialJson from '../../data/blr-potential.json';
import type { City } from '../../types';

export const CITIES: City[] = ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi-Dharwad', 'Belagavi', 'Tumakuru', 'Davanagere'];

/* ---------------- Pin boundaries ---------------- */

export interface PinShapeProps {
  pin: string;
  city: string;
}
export type PinShapes = FeatureCollection<MultiPolygon | Polygon, PinShapeProps>;

let shapesPromise: Promise<PinShapes> | null = null;

/** Fetch /ka-pins.geojson once per page load; later calls reuse the same promise. */
export function loadPinShapes(): Promise<PinShapes> {
  if (!shapesPromise) {
    shapesPromise = fetch('/ka-pins.geojson')
      .then((r) => {
        if (!r.ok) throw new Error(`Pin boundaries not found (${r.status})`);
        return r.json() as Promise<PinShapes>;
      })
      .catch((e) => {
        shapesPromise = null; // allow a retry
        throw e;
      });
  }
  return shapesPromise;
}

/* ---------------- Order flows (public/blr-flows.json) ---------------- */

export interface FlowStore {
  id: string;
  area: string;
  lat: number;
  lng: number;
  load_per_month: number;
  capacity_per_month: number;
  utilisation_pct: number;
}
export interface CandidateFlow {
  pin: string;
  fromStore: string;
  takenPerMonth: number;
  newPerMonth: number;
}
export interface Candidate {
  catchment_radius_km: number;
  flows: CandidateFlow[];
  store_load_after: Record<string, number>;
}
export interface FlowData {
  meta: { as_of: string; window: string; capacity_orders_per_month: number; far_travel_km: number; investment_lakh: number; fixed_cost_lakh_month: number; contribution_margin: number; payback_target_months: number; notes: string[] };
  stores: FlowStore[];
  baseline: { pin: string; store: string; perMonth: number }[];
  pins: Record<string, { online: number; missed: number; store: number; redirected: number }>;
  candidates: Record<string, Candidate>;
}

let flowsPromise: Promise<FlowData> | null = null;

export function loadFlows(): Promise<FlowData> {
  if (!flowsPromise) {
    flowsPromise = fetch('/blr-flows.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Order flow data not found (${r.status})`);
        return r.json() as Promise<FlowData>;
      })
      .catch((e) => {
        flowsPromise = null;
        throw e;
      });
  }
  return flowsPromise;
}

/* ---------------- New-store potential (src/data/blr-potential.json) ---------------- */

export interface PotentialPin {
  pin: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  nearest_store_id: string;
  nearest_store_km: number;
  missed_orders_month: number;
  missed_sales_lakh_month: number;
  redirected_orders_month: number;
  redirected_to: { store: string; ordersPerMonth: number }[];
  online_orders_month: number;
  store_orders_month: number;
  potential_orders_month: number;
  incremental_orders_month: number;
  cannibalised_orders_month: number;
  cannibalised_from: { store: string; area: string; ordersPerMonth: number; salesLakhPerMonth: number }[];
  capacity_use_pct: number;
  est_sales_lakh_month: number;
  est_profit_lakh_month: number;
  payback_months: number | null;
  annual_roi_pct: number;
  verdict: string;
  opportunity_index: number;
}

export const POTENTIAL = (potentialJson as unknown as { pins: PotentialPin[] }).pins;
export const POTENTIAL_BY_PIN: Record<string, PotentialPin> = Object.fromEntries(POTENTIAL.map((p) => [p.pin, p]));

/** Top places for a new store: most new (not cannibalised) orders, existing-store pins excluded. */
export const BEST_PLACES: PotentialPin[] = POTENTIAL.filter((p) => p.verdict !== 'Existing store here')
  .sort((a, b) => b.incremental_orders_month - a.incremental_orders_month || a.pin.localeCompare(b.pin))
  .slice(0, 8);

/* ---------------- Display names ---------------- */

/** ST-01's pin is the Bengaluru GPO; operators know it as the MG Road store. */
const STORE_AREA_OVERRIDE: Record<string, string> = { 'ST-01': 'MG Road' };
export const storeArea = (id: string, area: string) => STORE_AREA_OVERRIDE[id] ?? area;

/** A store is a heavy lifter when it runs at 75% of capacity or more. */
export const HEAVY_LIFTER_PCT = 75;

/* ---------------- Colour scales (single hue each, light = low) ---------------- */

const BLUE = ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];
const RED = ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#dc2626', '#991b1b'];

export type Scale = { stops: number[]; colors: string[] };
export const TRAFFIC_SCALE: Scale = { stops: [0, 10, 25, 50, 75, 100, 140], colors: BLUE };
export const LEAK_SCALE: Scale = { stops: [0, 5, 10, 20, 30, 45, 60], colors: RED };
export const OPPORTUNITY_SCALE: Scale = { stops: [0, 25, 50, 100, 150, 180, 210], colors: BLUE };
export const DEMAND_INDEX_SCALE: Scale = { stops: [0, 30, 45, 55, 65, 75, 85], colors: BLUE };

export function scaleColor(scale: Scale, v: number): string {
  let c = scale.colors[0];
  scale.stops.forEach((s, i) => {
    if (v >= s) c = scale.colors[i];
  });
  return c;
}

/** Line colours for traffic flows. */
export const FLOW_COLOR = { today: '#1d4ed8', taken: '#b45309', won: '#15803d', redirect: '#b91c1c', oldRoute: '#94a3b8' };

/** Line weight for an orders/month value (sqrt so big flows don't swamp the map). */
export const flowWeight = (perMonth: number) => Math.min(8, 0.6 + Math.sqrt(Math.max(0, perMonth)) * 0.55);

/* ---------------- Geometry ---------------- */

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same key always lands on the same spot, 120-400 m from the point, so markers on one pin don't stack. */
export function jitter(lat: number, lng: number, key: string): [number, number] {
  const h = hash32(key);
  const angle = ((h % 360) * Math.PI) / 180;
  const metres = 120 + ((h >>> 9) % 280);
  const dLat = (metres * Math.cos(angle)) / 111320;
  const dLng = (metres * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

/** Shift a segment sideways by `metres` (to draw two parallel lines between the same two points). */
export function offsetSegment(a: [number, number], b: [number, number], metres: number): [[number, number], [number, number]] {
  const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * kx;
  const dy = (b[0] - a[0]) * 111320;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * metres;
  const oy = (dx / len) * metres;
  const sh = (p: [number, number]): [number, number] => [p[0] + oy / 111320, p[1] + ox / kx];
  return [sh(a), sh(b)];
}
