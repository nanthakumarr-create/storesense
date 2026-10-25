// Lazy-loads the Bengaluru new-store potential (simulated order data) so it is not in the first page load.
import { useEffect, useState } from 'react';

export interface PinPotential {
  pin: string;
  name: string;
  nearest_store_id: string;
  nearest_store_km: number;
  missed_orders_month: number;
  missed_sales_lakh_month: number;
  redirected_orders_month: number;
  redirected_to: { store: string; ordersPerMonth: number }[];
  online_orders_month: number;
  store_orders_month: number;
  catchment_customers?: number;
  potential_orders_month: number;
  incremental_orders_month: number;
  cannibalised_orders_month: number;
  cannibalised_from: { store: string; area: string; ordersPerMonth: number; salesLakhPerMonth: number }[];
  capacity_orders_month?: number;
  capacity_use_pct: number;
  est_sales_lakh_month: number;
  est_profit_lakh_month: number;
  payback_months: number | null;
  annual_roi_pct: number | null;
  verdict: string;
  opportunity_index: number;
}

let cache: Record<string, PinPotential> | null = null;
let pending: Promise<Record<string, PinPotential>> | null = null;

function load(): Promise<Record<string, PinPotential>> {
  if (cache) return Promise.resolve(cache);
  pending ??= import('../../data/blr-potential.json').then((m) => {
    const data = (m.default ?? m) as unknown as { pins: PinPotential[] };
    cache = Object.fromEntries(data.pins.map((p) => [p.pin, p]));
    return cache;
  });
  return pending;
}

/** Potential for one pin: undefined while loading, null when the pin has no order data (outside Bengaluru). */
export function usePinPotential(pin: string | null): PinPotential | null | undefined {
  const [state, setState] = useState<{ pin: string | null; value: PinPotential | null | undefined }>({ pin, value: cache ? (pin ? cache[pin] ?? null : null) : undefined });
  useEffect(() => {
    let alive = true;
    if (!pin || !pin.startsWith('560')) {
      setState({ pin, value: null });
      return;
    }
    load()
      .then((c) => alive && setState({ pin, value: c[pin] ?? null }))
      .catch(() => alive && setState({ pin, value: null }));
    return () => {
      alive = false;
    };
  }, [pin]);
  return state.pin === pin ? state.value : undefined;
}
