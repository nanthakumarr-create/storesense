// Generates SIMULATED Bengaluru customer + order data for a Lenskart-like eyewear brand.
// Deterministic (fixed seed): the same files every run.
// Usage: node scripts/gen-customers.mjs
// Outputs:
//   data/generated/customers.csv, data/generated/orders.csv   (raw, loaded into Supabase)
//   src/data/blr-demand.json      (per-pin demand, bundled in the app as fallback)
//   src/data/blr-catchment.json   (per-store catchment, bundled in the app as fallback)
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pins = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-pins.json'), 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(root, 'public/blr-pins.geojson'), 'utf8'));

const N_CUSTOMERS = 10_000;
const START = Date.UTC(2024, 10, 1); // 1 Nov 2024
const END = Date.UTC(2026, 9, 24); // 24 Oct 2026 (day before AS_OF_DATE)

// Judges' fixed existing stores (Bengaluru only)
const STORES = [
  { id: 'ST-01', pin: '560001', opened: 2019 },
  { id: 'ST-02', pin: '560034', opened: 2020 },
  { id: 'ST-03', pin: '560038', opened: 2021 },
  { id: 'ST-04', pin: '560066', opened: 2022 },
  { id: 'ST-05', pin: '560076', opened: 2023 },
].map((s) => {
  const p = pins.find((x) => x.pin === s.pin);
  return { ...s, area: p.name, lat: p.lat, lng: p.lng };
});

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261025);
const pick = (arr, weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < arr.length; i++) if ((r -= weights[i]) <= 0) return arr[i];
  return arr[arr.length - 1];
};
const randNormal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const poisson = (mean) => { let k = 0, p = 1; const L = Math.exp(-mean); do { k++; p *= rand(); } while (p > L); return k - 1; };

const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// ---------- where customers live ----------
// Residential + tech-corridor pins get more customers; industrial, rural and campus pins fewer.
const HIGH = new Set(['034', '095', '102', '103', '037', '066', '048', '100', '068', '078', '041', '011', '038',
  '076', '043', '113', '092', '024', '032', '010', '079', '098', '061', '085', '050', '035', '087', '036', '093',
  '071', '008', '017', '016', '114', '040', '003', '004'].map((s) => '560' + s));
const LOW = new Set(['083', '089', '088', '105', '116', '117', '119', '074', '109', '099', '058', '049', '077',
  '012', '065', '107', '081', '115', '110', '082'].map((s) => '560' + s));
const pinWeight = (p) => {
  const zoneBase = { core: 1.0, inner: 1.0, outer: 0.6 }[p.zone];
  const cls = p.pin === '560300' ? 0.05 : HIGH.has(p.pin) ? 1.9 : LOW.has(p.pin) ? 0.3 : 1.0;
  return zoneBase * Math.sqrt(Math.min(p.areaKm2, 30)) * cls;
};

const polyByPin = new Map(geo.features.map((f) => [f.properties.pin, f.geometry.coordinates.map((poly) => poly[0])]));
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function pointInPin(pin) {
  const rings = polyByPin.get(pin.pin);
  const all = rings.flat();
  const [minX, maxX] = [Math.min(...all.map((c) => c[0])), Math.max(...all.map((c) => c[0]))];
  const [minY, maxY] = [Math.min(...all.map((c) => c[1])), Math.max(...all.map((c) => c[1]))];
  for (let t = 0; t < 200; t++) {
    const x = minX + rand() * (maxX - minX), y = minY + rand() * (maxY - minY);
    if (rings.some((r) => inRing(x, y, r))) return { lat: +y.toFixed(5), lng: +x.toFixed(5) };
  }
  return { lat: pin.lat, lng: pin.lng };
}

// ---------- products ----------
// Amounts in ₹. Eye tests are free in store; home eye test carries a small fee.
const PRODUCTS = [
  { cat: 'Eyeglasses', w: 52, median: 3200, sd: 0.45, min: 999, max: 14000 },
  { cat: 'Sunglasses', w: 14, median: 2600, sd: 0.4, min: 999, max: 9000 },
  { cat: 'Contact lenses', w: 20, median: 1500, sd: 0.35, min: 500, max: 4500 },
  { cat: 'Eye test', w: 14, median: 0, sd: 0, min: 0, max: 0 },
];
const amountFor = (prod, channel) => {
  if (prod.cat === 'Eye test') return channel === 'Online delivery' ? 99 : 0;
  const v = prod.median * Math.exp(prod.sd * randNormal());
  return Math.round(Math.min(prod.max, Math.max(prod.min, v)) / 10) * 10 - 1; // ₹x,xx9 price points
};

// ---------- order dates: growth trend + festive bump (Oct/Nov) ----------
function orderDate() {
  for (;;) {
    const t = START + rand() * (END - START);
    const d = new Date(t);
    const growth = 0.7 + 0.6 * ((t - START) / (END - START));
    const festive = [9, 10].includes(d.getUTCMonth()) ? 1.35 : 1;
    if (rand() < (growth * festive) / 1.8) return d.toISOString().slice(0, 10);
  }
}

// ---------- generate ----------
const weights = pins.map(pinWeight);
const AGE = ['18-24', '25-34', '35-44', '45-54', '55+'];
const AGE_W = [18, 34, 24, 14, 10];
const customers = [];
const orders = [];
let orderSeq = 0;

for (let i = 1; i <= N_CUSTOMERS; i++) {
  const pin = pick(pins, weights);
  const home = pointInPin(pin);
  const byDist = STORES.map((s) => ({ s, d: km(home, s) })).sort((a, b) => a.d - b.d);
  const nearest = byDist[0];
  const id = 'C' + String(i).padStart(5, '0');
  const nOrders = 1 + poisson(1.7);
  const dates = Array.from({ length: nOrders }, orderDate).sort();
  customers.push({
    customer_id: id, home_pin: pin.pin, home_area: pin.name, lat: home.lat, lng: home.lng,
    age_band: pick(AGE, AGE_W), first_order_date: dates[0],
    nearest_store_id: nearest.s.id, nearest_store_km: +nearest.d.toFixed(2),
  });
  // Store visits fall off with distance to the nearest store; far customers buy online
  const pWalkin = 0.72 * Math.exp(-nearest.d / 4);
  const pPickup = 0.14 * Math.exp(-nearest.d / 9);
  for (const date of dates) {
    const r = rand();
    const channel = r < pWalkin ? 'Store walk-in' : r < pWalkin + pPickup ? 'Click & collect' : 'Online delivery';
    // Mostly the nearest store; sometimes the second nearest (near work, mall trips)
    const chosen = channel === 'Online delivery' ? null : rand() < 0.85 ? nearest : byDist[1];
    const prod = pick(PRODUCTS, PRODUCTS.map((p) => p.w));
    orders.push({
      order_id: 'O' + String(++orderSeq).padStart(6, '0'), customer_id: id, order_date: date,
      home_pin: pin.pin, channel, store_id: chosen ? chosen.s.id : '',
      distance_to_store_km: chosen ? +chosen.d.toFixed(2) : '',
      category: prod.cat, amount_inr: amountFor(prod, channel),
    });
  }
}

// ---------- aggregates ----------
const demand = pins.map((p) => {
  const os = orders.filter((o) => o.home_pin === p.pin);
  const cs = customers.filter((c) => c.home_pin === p.pin);
  const nearest = STORES.map((s) => ({ s, d: km(p, s) })).sort((a, b) => a.d - b.d)[0];
  const online = os.filter((o) => o.channel === 'Online delivery').length;
  return {
    pin: p.pin, name: p.name, zone: p.zone, lat: p.lat, lng: p.lng,
    customers: cs.length, orders: os.length,
    online_orders: online,
    store_orders: os.length - online,
    online_share: os.length ? +(online / os.length).toFixed(3) : 0,
    revenue_inr: os.reduce((a, o) => a + o.amount_inr, 0),
    orders_last_12m: os.filter((o) => o.order_date >= '2025-10-25').length,
    nearest_store_id: nearest.s.id, nearest_store_km: +nearest.d.toFixed(2),
  };
});
// Demand index 0-100: orders in the last 12 months, scaled to the busiest pin
const maxRecent = Math.max(...demand.map((d) => d.orders_last_12m));
for (const d of demand) d.demand_index = Math.round((100 * d.orders_last_12m) / maxRecent);

const catchment = STORES.map((s) => {
  const os = orders.filter((o) => o.store_id === s.id);
  const dists = os.map((o) => o.distance_to_store_km).sort((a, b) => a - b);
  const byPin = {};
  for (const o of os) byPin[o.home_pin] = (byPin[o.home_pin] || 0) + 1;
  const top = Object.entries(byPin).sort((a, b) => b[1] - a[1]);
  return {
    store_id: s.id, pin: s.pin, area: s.area, lat: s.lat, lng: s.lng, opened: s.opened,
    store_orders: os.length,
    walkin_orders: os.filter((o) => o.channel === 'Store walk-in').length,
    pickup_orders: os.filter((o) => o.channel === 'Click & collect').length,
    revenue_inr: os.reduce((a, o) => a + o.amount_inr, 0),
    avg_customer_km: +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(2),
    p80_customer_km: dists[Math.floor(dists.length * 0.8)],
    max_customer_km: dists[dists.length - 1],
    pins_served: top.length,
    top_source_pins: top.slice(0, 8).map(([pin, n]) => ({ pin, name: pins.find((p) => p.pin === pin).name, orders: n })),
  };
});

// ---------- write ----------
const toCsv = (rows) => {
  const cols = Object.keys(rows[0]);
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
};
fs.mkdirSync(path.join(root, 'data/generated'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/generated/customers.csv'), toCsv(customers));
fs.writeFileSync(path.join(root, 'data/generated/orders.csv'), toCsv(orders));
fs.writeFileSync(path.join(root, 'src/data/blr-demand.json'), JSON.stringify(demand, null, 1));
fs.writeFileSync(path.join(root, 'src/data/blr-catchment.json'), JSON.stringify(catchment, null, 1));

// ---------- summary ----------
const ch = orders.reduce((m, o) => ((m[o.channel] = (m[o.channel] || 0) + 1), m), {});
const cat = orders.reduce((m, o) => ((m[o.category] = (m[o.category] || 0) + 1), m), {});
console.log(`customers ${customers.length}, orders ${orders.length}`);
console.log('channels', ch);
console.log('categories', cat);
console.log('revenue ₹ crore', (orders.reduce((a, o) => a + o.amount_inr, 0) / 1e7).toFixed(2));
console.log('\nstores:');
for (const c of catchment) console.log(` ${c.store_id} ${c.area.padEnd(18)} orders ${c.store_orders}  avg ${c.avg_customer_km} km  p80 ${c.p80_customer_km} km  top: ${c.top_source_pins.slice(0, 3).map((t) => t.name).join(', ')}`);
console.log('\ntop 10 gaps (online orders, far from store):');
for (const d of [...demand].filter((d) => d.nearest_store_km > 4).sort((a, b) => b.online_orders - a.online_orders).slice(0, 10))
  console.log(` ${d.pin} ${d.name.padEnd(22)} online ${d.online_orders}  share ${(d.online_share * 100).toFixed(0)}%  nearest ${d.nearest_store_id} ${d.nearest_store_km} km`);
