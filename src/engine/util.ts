// Small pure helpers shared by the parser and the engine.
import type { City } from '../types';
import { AS_OF_DATE } from '../config/rules';

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Lower-case, drop everything that is not a letter or digit (₹, spaces, slashes, brackets...). */
export const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
export const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

const CITY_ALIASES: Record<string, City> = {
  bengaluru: 'Bengaluru', bangalore: 'Bengaluru', bengaluruurban: 'Bengaluru', bangaloreurban: 'Bengaluru', blr: 'Bengaluru', bengalooru: 'Bengaluru',
  mysuru: 'Mysuru', mysore: 'Mysuru',
  mangaluru: 'Mangaluru', mangalore: 'Mangaluru', mangalooru: 'Mangaluru',
  hubballidharwad: 'Hubballi-Dharwad', hublidharwad: 'Hubballi-Dharwad', hubballi: 'Hubballi-Dharwad', hubli: 'Hubballi-Dharwad', dharwad: 'Hubballi-Dharwad', hubblidharwad: 'Hubballi-Dharwad',
  belagavi: 'Belagavi', belgaum: 'Belagavi', belgavi: 'Belagavi',
  tumakuru: 'Tumakuru', tumkur: 'Tumakuru', tumakur: 'Tumakuru',
  davanagere: 'Davanagere', davangere: 'Davanagere', davanagare: 'Davanagere', davangare: 'Davanagere',
};
export function matchCity(v: unknown): City | null {
  const n = norm(v).replace(/[0-9]/g, '');
  if (!n) return null;
  if (CITY_ALIASES[n]) return CITY_ALIASES[n];
  for (const [k, c] of Object.entries(CITY_ALIASES)) if (k.length >= 5 && n.includes(k)) return c;
  return null;
}

/** ISO date `days` after AS_OF_DATE (UTC maths, no clock reads). */
export function addDays(days: number, from: string = AS_OF_DATE): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** FNV-1a 32-bit, hex. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const lakh = (n: number) => `₹${round1(n)} L`;
export const km = (n: number) => `${round1(n)} km`;
