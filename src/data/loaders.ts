// Reference data for the engine and the map.
// Demand + catchment come live from Supabase (storesense schema, read-only aggregates);
// if Supabase is slow or down, the bundled copy of the same data is used so the app never breaks.
import { createClient } from '@supabase/supabase-js';
import kaPins from './ka-pins.json';
import bundledDemand from './blr-demand.json';
import bundledCatchment from './blr-catchment.json';
import type { EngineContext, PinDemand, PinInfo, StoreCatchment } from '../types';

export const PINS = kaPins as PinInfo[];
export const PIN_BY_CODE: Record<string, PinInfo> = Object.fromEntries(PINS.map((p) => [p.pin, p]));

export interface DemandSourceInfo {
  source: 'supabase' | 'bundled';
  fetchedAt: string;
  error?: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const TIMEOUT_MS = 4000;

function bundled(error?: string): { ctx: EngineContext; info: DemandSourceInfo } {
  return {
    ctx: {
      pins: PINS,
      demand: Object.fromEntries((bundledDemand as PinDemand[]).map((d) => [d.pin, d])),
      catchment: bundledCatchment as StoreCatchment[],
    },
    info: { source: 'bundled', fetchedAt: new Date().toISOString(), error },
  };
}

export async function loadEngineContext(): Promise<{ ctx: EngineContext; info: DemandSourceInfo }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return bundled('Supabase not configured');
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: 'storesense' }, auth: { persistSession: false } });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Supabase timed out')), TIMEOUT_MS));
    const [demand, catchment] = await Promise.race([
      Promise.all([db.from('pin_demand').select('*'), db.from('store_catchment').select('*')]),
      timeout,
    ]);
    if (demand.error || catchment.error || !demand.data?.length) throw new Error(demand.error?.message || catchment.error?.message || 'empty');
    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    const rows = (demand.data as Record<string, unknown>[]).map(
      (d) =>
        ({
          ...d,
          customers: num(d.customers), orders: num(d.orders), online_orders: num(d.online_orders), store_orders: num(d.store_orders),
          online_share: num(d.online_share), revenue_inr: num(d.revenue_inr), orders_last_12m: num(d.orders_last_12m),
          demand_index: num(d.demand_index), nearest_store_km: num(d.nearest_store_km), lat: num(d.lat), lng: num(d.lng),
        }) as PinDemand,
    );
    const stores = (catchment.data as Record<string, unknown>[]).map(
      (c) =>
        ({
          ...c,
          store_orders: num(c.store_orders), walkin_orders: num(c.walkin_orders), pickup_orders: num(c.pickup_orders),
          revenue_inr: num(c.revenue_inr), avg_customer_km: num(c.avg_customer_km), p80_customer_km: num(c.p80_customer_km),
          max_customer_km: num(c.max_customer_km), pins_served: num(c.pins_served), lat: num(c.lat), lng: num(c.lng), opened: num(c.opened),
        }) as StoreCatchment,
    );
    return {
      ctx: { pins: PINS, demand: Object.fromEntries(rows.map((d) => [d.pin, d])), catchment: stores },
      info: { source: 'supabase', fetchedAt: new Date().toISOString() },
    };
  } catch (e) {
    return bundled(e instanceof Error ? e.message : String(e));
  }
}

export async function fetchSampleWorkbook(): Promise<ArrayBuffer> {
  const res = await fetch('/sample/StoreSense_Applicants_200.xlsx');
  if (!res.ok) throw new Error(`Sample file not found (${res.status})`);
  return res.arrayBuffer();
}
