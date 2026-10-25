// Demand per pin, shared by the engine and the map so both always show the same number.
// Bengaluru pins: simulated order data (demand_index 0-100). Other pins: the rulebook proxy.
import type { City, EngineContext, PinInfo, Tier } from '../types';
import { CITY_CENTRE, CITY_TIER, DEMAND_PROXY_BASE, DEMAND_PROXY_CORE_BONUS } from '../config/rules';
import { haversineKm } from '../lib/geo';

export interface PinDemandIndex {
  index: number; // 0-100
  source: 'orders' | 'proxy';
  onlineOrders: number | null;
  ordersLast12m: number | null;
}

/** Proxy for pins without order data: tier base + bonus within 3 km of the city centre. */
export function proxyDemand(tier: Tier, pinInfo: Pick<PinInfo, 'lat' | 'lng' | 'city'> | null): number {
  const base = DEMAND_PROXY_BASE[tier];
  if (!pinInfo) return base;
  const centre = CITY_CENTRE[pinInfo.city as City];
  return centre && haversineKm(pinInfo, centre) <= 3 ? base + DEMAND_PROXY_CORE_BONUS : base;
}

export function demandIndexFor(pin: string, ctx: EngineContext): PinDemandIndex {
  const d = ctx.demand[pin];
  if (d) return { index: d.demand_index, source: 'orders', onlineOrders: d.online_orders, ordersLast12m: d.orders_last_12m };
  const info = ctx.pins.find((p) => p.pin === pin) ?? null;
  const tier = info ? info.tier : (CITY_TIER[cityFromPin(pin) ?? 'Bengaluru'] ?? 'Tier 2');
  return { index: proxyDemand(tier, info), source: 'proxy', onlineOrders: null, ordersLast12m: null };
}

const PREFIX_CITY: Record<string, City> = {
  '560': 'Bengaluru', '570': 'Mysuru', '575': 'Mangaluru', '580': 'Hubballi-Dharwad', '590': 'Belagavi', '572': 'Tumakuru', '577': 'Davanagere',
};
export function cityFromPin(pin: string): City | null {
  return PREFIX_CITY[pin.slice(0, 3)] ?? null;
}
