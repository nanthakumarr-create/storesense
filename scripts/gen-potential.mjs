// Opportunity model per Bengaluru pin, computed from the simulated customers + orders.
// For each pin: (a) MISSED walk-in demand today, (b) orders REDIRECTED to far stores today,
// (c) POTENTIAL of a new store at the pin centroid: orders captured (new vs taken from existing stores),
//     monthly sales, capacity use, and store P&L (ROI, payback).
// Same channel model as gen-customers.mjs: store share falls off with distance to the nearest store.
// Usage: node scripts/gen-potential.mjs   → src/data/blr-potential.json
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const AS_OF = '2026-10-25';
const LAST_12M_FROM = '2025-10-25';

// ---------- assumptions (mirrored in the app's assumptions panel via `meta`) ----------
const WALKIN = { share: 0.72, decayKm: 4 }; // same as the customer simulation
const PICKUP = { share: 0.14, decayKm: 9 };
const NEAR_STORE_KM = 0.8; // "a store in your own pin" ≈ this far on average
const FAR_TRAVEL_KM = 4; // store orders from further than this count as redirected to a far store
const T1 = { investmentLakh: 35, baseSalesLakh: 9.5, fixedCostLakh: 1.9 }; // rules.ts TIER_ECONOMICS['Tier 1']
const CONTRIBUTION_MARGIN = 0.35; // rules.ts
const PAYBACK_TARGET = 30;
// A standard 400-600 sq ft store with one eye-test room: ~20 customer orders a day (eye test ≈ 20-30 min), 30 days → 600 a month.
const CAPACITY_ORDERS_PER_MONTH = 600;

const storeShare = (d) => WALKIN.share * Math.exp(-d / WALKIN.decayKm) + PICKUP.share * Math.exp(-d / PICKUP.decayKm);
const rad = (x) => (x * Math.PI) / 180;
const km = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const readCsv = (f) => {
  const [h, ...rows] = fs.readFileSync(path.join(root, f), 'utf8').trim().split(/\r?\n/);
  const cols = h.split(',');
  return rows.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};

const pins = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-pins.json'), 'utf8'));
const catchment = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-catchment.json'), 'utf8'));
const customers = readCsv('data/generated/customers.csv').map((c) => ({ ...c, lat: +c.lat, lng: +c.lng, nearest_store_km: +c.nearest_store_km }));
const orders = readCsv('data/generated/orders.csv').filter((o) => o.order_date >= LAST_12M_FROM && o.order_date < AS_OF);

// Orders per customer in the last 12 months, and average order value of STORE orders (what a franchise store sells)
const freq = new Map();
for (const o of orders) freq.set(o.customer_id, (freq.get(o.customer_id) || 0) + 1);
const storeOrders = orders.filter((o) => o.channel !== 'Online delivery');
const storeAov = storeOrders.reduce((s, o) => s + +o.amount_inr, 0) / storeOrders.length;

// Calibration: the 10k customers are a sample. Scale so today's 5 stores average the Tier 1 sales assumption.
const perStoreMonthlySalesSample = (storeOrders.length / catchment.length / 12) * storeAov;
const SCALE = (T1.baseSalesLakh * 1e5) / perStoreMonthlySalesSample;

const stores = catchment.map((s) => ({ id: s.store_id, area: s.area, lat: s.lat, lng: s.lng }));
const nearestStore = (p) => stores.map((s) => ({ s, d: km(p, s) })).sort((a, b) => a.d - b.d)[0];
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- today: missed + redirected, by home pin ----------
const today = new Map(pins.map((p) => [p.pin, { missed: 0, redirectedTo: {}, redirected: 0, online: 0, store: 0 }]));
for (const c of customers) {
  const f = freq.get(c.customer_id) || 0;
  if (!f) continue;
  const t = today.get(c.home_pin);
  // Store orders this customer would make with a store in their own pin, minus what they make today
  t.missed += f * Math.max(0, storeShare(NEAR_STORE_KM) - storeShare(c.nearest_store_km));
}
for (const o of orders) {
  const t = today.get(o.home_pin);
  if (o.channel === 'Online delivery') t.online++;
  else {
    t.store++;
    if (+o.distance_to_store_km > FAR_TRAVEL_KM) {
      t.redirected++;
      t.redirectedTo[o.store_id] = (t.redirectedTo[o.store_id] || 0) + 1;
    }
  }
}

// ---------- store load today (actual simulated store orders, last 12 months, scaled, per month) ----------
const storeLoad = Object.fromEntries(stores.map((s) => [s.id, 0]));
const baselineFlows = new Map(); // "homePin|store" → orders
for (const o of storeOrders) {
  storeLoad[o.store_id] += SCALE / 12;
  baselineFlows.set(`${o.home_pin}|${o.store_id}`, (baselineFlows.get(`${o.home_pin}|${o.store_id}`) || 0) + SCALE / 12);
}
const candidateFlows = {};

// ---------- potential new store at each pin ----------
const out = pins.map((p) => {
  let captured = 0, incremental = 0, catchmentCustomers = 0;
  const cannibal = {};
  const flowMap = new Map(); // "homePin|fromStore" → { taken, gained }
  const switchDists = [];
  for (const c of customers) {
    const f = freq.get(c.customer_id) || 0;
    if (!f) continue;
    const dNew = Math.max(NEAR_STORE_KM * 0.5, km(c, p));
    if (dNew >= c.nearest_store_km) continue; // the new store is not their closest → no change
    catchmentCustomers++;
    switchDists.push(dNew);
    const before = f * storeShare(c.nearest_store_km);
    const after = f * storeShare(dNew);
    captured += after;
    incremental += after - before;
    const prevStore = nearestStore(c).s.id;
    cannibal[prevStore] = (cannibal[prevStore] || 0) + before;
    const key = `${c.home_pin}|${prevStore}`;
    const fl = flowMap.get(key) ?? { taken: 0, gained: 0 };
    fl.taken += before;
    fl.gained += after - before;
    flowMap.set(key, fl);
  }
  switchDists.sort((a, b) => a - b);
  candidateFlows[p.pin] = {
    catchment_radius_km: switchDists.length ? round(switchDists[Math.floor(switchDists.length * 0.8)], 2) : 0,
    flows: [...flowMap.entries()]
      .map(([k, v]) => {
        const [pin, fromStore] = k.split('|');
        return { pin, fromStore, takenPerMonth: round((v.taken * SCALE) / 12), newPerMonth: round((v.gained * SCALE) / 12) };
      })
      .filter((x) => x.takenPerMonth + x.newPerMonth >= 1)
      .sort((a, b) => b.takenPerMonth + b.newPerMonth - (a.takenPerMonth + a.newPerMonth)),
    store_load_after: Object.fromEntries(stores.map((s) => [s.id, round(storeLoad[s.id] - ((cannibal[s.id] || 0) * SCALE) / 12)])),
  };
  const near = nearestStore(p);
  const t = today.get(p.pin);
  // Scale sample → real and to a monthly figure
  const capturedMonth = (captured * SCALE) / 12;
  const incrementalMonth = (incremental * SCALE) / 12;
  const salesLakh = (capturedMonth * storeAov) / 1e5;
  const profitLakh = salesLakh * CONTRIBUTION_MARGIN - T1.fixedCostLakh;
  const payback = profitLakh > 0 ? T1.investmentLakh / profitLakh : null;
  const cannibalMonth = Object.entries(cannibal)
    .map(([store, n]) => ({ store, area: stores.find((s) => s.id === store).area, ordersPerMonth: round((n * SCALE) / 12), salesLakhPerMonth: round(((n * SCALE) / 12) * storeAov / 1e5, 2) }))
    .filter((x) => x.ordersPerMonth > 0)
    .sort((a, b) => b.ordersPerMonth - a.ordersPerMonth);
  const verdict = t && near.d < 1 ? 'Existing store here' : payback !== null && payback <= PAYBACK_TARGET ? (capturedMonth > CAPACITY_ORDERS_PER_MONTH ? 'Strong — exceeds one store' : 'Viable') : 'Below payback target';
  return {
    pin: p.pin, name: p.name, zone: p.zone, lat: p.lat, lng: p.lng,
    nearest_store_id: near.s.id, nearest_store_km: round(near.d, 2),
    // today (per month, scaled)
    missed_orders_month: round((t.missed * SCALE) / 12),
    missed_sales_lakh_month: round(((t.missed * SCALE) / 12) * storeAov / 1e5, 2),
    redirected_orders_month: round((t.redirected * SCALE) / 12),
    redirected_to: Object.entries(t.redirectedTo).sort((a, b) => b[1] - a[1]).map(([store, n]) => ({ store, ordersPerMonth: round((n * SCALE) / 12) })),
    online_orders_month: round((t.online * SCALE) / 12),
    store_orders_month: round((t.store * SCALE) / 12),
    // potential new store here
    catchment_customers: round(catchmentCustomers * SCALE),
    potential_orders_month: round(capturedMonth),
    incremental_orders_month: round(incrementalMonth),
    cannibalised_orders_month: round(capturedMonth - incrementalMonth),
    cannibalised_from: cannibalMonth,
    capacity_orders_month: CAPACITY_ORDERS_PER_MONTH,
    capacity_use_pct: round((100 * capturedMonth) / CAPACITY_ORDERS_PER_MONTH),
    est_sales_lakh_month: round(salesLakh, 2),
    est_profit_lakh_month: round(profitLakh, 2),
    payback_months: payback === null ? null : round(payback, 1),
    annual_roi_pct: round((100 * profitLakh * 12) / T1.investmentLakh, 1),
    verdict,
  };
});

// Opportunity index 0-100 for the heatmap: incremental orders, scaled to the best pin (existing-store pins → 0)
const maxInc = Math.max(...out.map((o) => (o.verdict === 'Existing store here' ? 0 : o.incremental_orders_month)));
for (const o of out) o.opportunity_index = o.verdict === 'Existing store here' ? 0 : Math.max(0, Math.round((100 * o.incremental_orders_month) / maxInc));

const meta = {
  as_of: AS_OF,
  window: `${LAST_12M_FROM} to ${AS_OF} (last 12 months)`,
  sample_scale: round(SCALE, 2),
  store_aov_inr: round(storeAov),
  capacity_orders_per_month: CAPACITY_ORDERS_PER_MONTH,
  investment_lakh: T1.investmentLakh,
  fixed_cost_lakh_month: T1.fixedCostLakh,
  contribution_margin: CONTRIBUTION_MARGIN,
  payback_target_months: PAYBACK_TARGET,
  near_store_km: NEAR_STORE_KM,
  far_travel_km: FAR_TRAVEL_KM,
  notes: [
    'Simulated order data. The 10,000 customers are a sample, scaled so today\'s five Bengaluru stores average the Tier 1 sales assumption (₹9.5L a month).',
    'Missed orders: store purchases a pin\'s customers would make if a store were in their own pin, minus what they make today (they buy online instead or not at all).',
    'Redirected orders: store purchases made by travelling more than 4 km to a far store.',
    'New-store potential: customers for whom the new store would be the closest; their store purchases rise as travel distance falls. Purchases they made at an existing store count as taken from that store (cannibalisation).',
    'Capacity: one standard store (400-600 sq ft, one eye-test room) handles about 20 orders a day (600 a month).',
  ],
};
fs.writeFileSync(path.join(root, 'src/data/blr-potential.json'), JSON.stringify({ meta, pins: out }, null, 1));

// Traffic flows for the map (fetched lazily from /blr-flows.json): who feeds which store today, and how a new store would split it.
const flows = {
  meta: { ...meta, unit: 'orders per month (scaled)' },
  stores: stores.map((s) => ({
    id: s.id, area: s.area, lat: s.lat, lng: s.lng,
    load_per_month: round(storeLoad[s.id]),
    capacity_per_month: CAPACITY_ORDERS_PER_MONTH,
    utilisation_pct: round((100 * storeLoad[s.id]) / CAPACITY_ORDERS_PER_MONTH),
  })),
  baseline: [...baselineFlows.entries()]
    .map(([k, v]) => { const [pin, store] = k.split('|'); return { pin, store, perMonth: round(v) }; })
    .filter((x) => x.perMonth >= 1),
  pins: Object.fromEntries(out.map((o) => [o.pin, { online: o.online_orders_month, missed: o.missed_orders_month, store: o.store_orders_month, redirected: o.redirected_orders_month }])),
  candidates: candidateFlows,
};
fs.writeFileSync(path.join(root, 'public/blr-flows.json'), JSON.stringify(flows));
console.log('store load today:', flows.stores.map((s) => `${s.id} ${s.area} ${s.load_per_month}/mo (${s.utilisation_pct}%)`).join(' | '));

console.log(`scale x${meta.sample_scale}, store AOV ₹${meta.store_aov_inr}`);
const viable = out.filter((o) => o.verdict !== 'Existing store here').sort((a, b) => b.incremental_orders_month - a.incremental_orders_month);
console.log('\nTop 10 new-store pins (per month):');
for (const o of viable.slice(0, 10))
  console.log(` ${o.pin} ${o.name.padEnd(22)} potential ${String(o.potential_orders_month).padStart(4)} (new ${String(o.incremental_orders_month).padStart(4)}, taken ${String(o.cannibalised_orders_month).padStart(3)})  cap ${String(o.capacity_use_pct).padStart(3)}%  sales ₹${o.est_sales_lakh_month}L  payback ${o.payback_months ?? '—'} mo  ROI ${o.annual_roi_pct}%  ${o.verdict}`);
console.log('\nTop 5 missed-demand pins today:');
for (const o of [...out].sort((a, b) => b.missed_orders_month - a.missed_orders_month).slice(0, 5))
  console.log(` ${o.pin} ${o.name.padEnd(22)} missed ${o.missed_orders_month}/mo (₹${o.missed_sales_lakh_month}L)  redirected ${o.redirected_orders_month}/mo → ${o.redirected_to.map((r) => r.store).join(', ') || '—'}`);
console.log('\nverdicts:', out.reduce((m, o) => ((m[o.verdict] = (m[o.verdict] || 0) + 1), m), {}));
console.log('existing store sanity (pins with store):', out.filter((o) => o.verdict === 'Existing store here').map((o) => o.pin).join(', '));
