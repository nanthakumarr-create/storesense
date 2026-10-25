// Map-only helpers: pin boundary shapes (fetched once), demand colour scale, deterministic jitter.
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { City } from '../../types';

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

export const CITIES: City[] = ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi-Dharwad', 'Belagavi', 'Tumakuru', 'Davanagere'];

/** Sequential single-hue (teal) scale on the 0-100 demand index. Light = low demand, dark = high. */
export const DEMAND_BINS: { min: number; color: string }[] = [
  { min: 0, color: '#e8f6f3' },
  { min: 15, color: '#c4eae3' },
  { min: 30, color: '#93d7cc' },
  { min: 45, color: '#5dbfb2' },
  { min: 60, color: '#2f9f93' },
  { min: 75, color: '#157b72' },
  { min: 90, color: '#0b524c' },
];

export function demandColor(index: number): string {
  let c = DEMAND_BINS[0].color;
  for (const b of DEMAND_BINS) if (index >= b.min) c = b.color;
  return c;
}

export function demandLabel(city: string): string {
  return city === 'Bengaluru' ? 'Simulated online orders (last 12 months)' : 'Demand proxy v1 (tier + centre)';
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same uid always lands on the same spot, 120-400 m from the pin centroid, so same-pin applicants don't stack. */
export function jitter(lat: number, lng: number, key: string): [number, number] {
  const h = hash32(key);
  const angle = ((h % 360) * Math.PI) / 180;
  const metres = 120 + ((h >>> 9) % 280);
  const dLat = (metres * Math.cos(angle)) / 111320;
  const dLng = (metres * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}
