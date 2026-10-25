// Place layer: where is the pin, how far is the nearest store, how much demand is there, and the place score.
import type { City, EngineContext, ExistingStore, PinInfo, PlaceInfo, Priority, Territory, Tier } from '../types';
import { CITY_CENTRE, CITY_TIER, DEMAND_PROXY_BASE, OVERLAP_PLACE_PENALTY, OVERLAP_RADIUS_KM, PLACE_WEIGHTS, PRIORITY_ORDER } from '../config/rules';
import { haversineKm } from '../lib/geo';
import { cityFromPin, demandIndexFor } from './demand';
import { clamp, round2 } from './util';

export interface StorePoint {
  id: string;
  pin: string;
  city: string;
  area: string;
  lat: number;
  lng: number;
  approx: boolean; // store pin not in the pin list: city centre used
}

export interface Geo {
  pinInfo: (pin: string | null) => PinInfo | null;
  stores: StorePoint[];
  storePins: Map<string, string>; // pin → store ID
  territoryByPin: Map<string, Territory>;
  multiTerritoryPins: Map<string, string[]>;
  ctx: EngineContext;
}

export function buildGeo(ctx: EngineContext, stores: ExistingStore[], territories: Territory[]): Geo {
  const byPin = new Map(ctx.pins.map((p) => [p.pin, p]));
  const catchByPin = new Map(ctx.catchment.map((c) => [c.pin, c]));
  const pts: StorePoint[] = stores.map((s) => {
    const info = byPin.get(s.pin);
    const centre = CITY_CENTRE[s.city as City] ?? CITY_CENTRE.Bengaluru;
    return {
      id: s.id,
      pin: s.pin,
      city: s.city,
      area: catchByPin.get(s.pin)?.area ?? info?.name ?? s.city,
      lat: info?.lat ?? centre.lat,
      lng: info?.lng ?? centre.lng,
      approx: !info,
    };
  });
  const storePins = new Map(stores.map((s) => [s.pin, s.id]));
  // A pin listed in two territories goes to the higher-priority one (then lower ID).
  const sorted = [...territories].sort(territoryOrder);
  const territoryByPin = new Map<string, Territory>();
  const multi = new Map<string, string[]>();
  for (const t of sorted) {
    for (const p of t.pins) {
      if (territoryByPin.has(p)) multi.set(p, [...(multi.get(p) ?? [territoryByPin.get(p)!.id]), t.id]);
      else territoryByPin.set(p, t);
    }
  }
  return { pinInfo: (pin) => (pin ? (byPin.get(pin) ?? null) : null), stores: pts, storePins, territoryByPin, multiTerritoryPins: multi, ctx };
}

export function territoryOrder(a: Territory, b: Territory): number {
  return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.id.localeCompare(b.id) || a.rowNumber - b.rowNumber;
}

export function tierForPin(pin: string | null, city: string, geo: Geo, territory: Territory | null): Tier {
  const info = geo.pinInfo(pin);
  if (info) return info.tier;
  const c = (pin ? cityFromPin(pin) : null) ?? (city as City);
  return CITY_TIER[c as City] ?? territory?.tier ?? 'Tier 2';
}

export function nearestStore(pt: { lat: number; lng: number }, stores: StorePoint[]): { store: StorePoint; km: number } | null {
  let best: { store: StorePoint; km: number } | null = null;
  for (const s of stores) {
    const d = haversineKm(pt, s);
    if (!best || d < best.km || (d === best.km && s.id < best.store.id)) best = { store: s, km: d };
  }
  return best;
}

export function placeScoreOf(unservedNorm: number, demand: number, inside: boolean): number {
  return round2(clamp(PLACE_WEIGHTS.unserved * unservedNorm + PLACE_WEIGHTS.demand * demand - (inside ? OVERLAP_PLACE_PENALTY : 0)));
}

/** Place info for a pin. The overlap check uses existing stores only; stores approved in this run are checked during allocation. */
export function placeFor(pin: string | null, city: string, geo: Geo): PlaceInfo & { tier: Tier; territory: Territory | null } {
  const territory = pin ? (geo.territoryByPin.get(pin) ?? null) : null;
  const tier = tierForPin(pin, city, geo, territory);
  const info = geo.pinInfo(pin);
  const radius = OVERLAP_RADIUS_KM[tier];
  const d = pin ? demandIndexFor(pin, geo.ctx) : { index: DEMAND_PROXY_BASE[tier], source: 'proxy' as const };
  const samePin = pin ? (geo.storePins.get(pin) ?? null) : null;
  let nearest: PlaceInfo['nearestStore'] = null;
  let inside = false;
  let unserved = 100;
  if (info) {
    const n = nearestStore(info, geo.stores);
    if (n) {
      const kmv = samePin ? 0 : Math.max(n.km, 0.1);
      nearest = { id: samePin ?? n.store.id, pin: samePin ? pin! : n.store.pin, area: n.store.area, km: round2(kmv) };
      if (samePin) {
        const s = geo.stores.find((x) => x.id === samePin);
        if (s) nearest.area = s.area;
      }
      inside = !samePin && n.km < radius;
      unserved = round2(100 * Math.min(1, kmv / radius));
    }
  } else {
    // location unverified: no radius check, never distance 0; unserved left neutral
    unserved = 50;
  }
  return {
    pin,
    pinName: info?.name ?? (pin ? `Pin ${pin}` : 'Unknown pin'),
    territoryId: territory?.id ?? null,
    territoryPriority: (territory?.priority as Priority | undefined) ?? null,
    nearestStore: nearest,
    overlapRadiusKm: radius,
    insideOverlapRadius: inside,
    samePinAsStore: samePin,
    demandIndex: round2(d.index),
    demandSource: d.source,
    unservedNorm: unserved,
    placeScore: samePin ? 0 : placeScoreOf(unserved, d.index, inside),
    locationApproximate: !info,
    tier,
    territory,
  };
}

