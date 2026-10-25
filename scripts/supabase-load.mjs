// Loads the simulated Bengaluru data into Supabase project `universal`, schema `storesense`.
// Idempotent: creates tables if missing, then replaces the rows of OUR tables only.
// Raw customers/orders are private (no anon access); aggregates are public read-only for the app.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/supabase-load.mjs
import fs from 'node:fs';
import path from 'node:path';

const REF = 'drgpjdemhlawwzbwxkfy';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN not set');
const root = process.cwd();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const DDL = `
create schema if not exists storesense;

create table if not exists storesense.pins (
  pin text primary key, name text not null, division text, lat double precision not null, lng double precision not null,
  area_km2 numeric, distance_from_centre_km numeric, zone text not null
);
create table if not exists storesense.stores (
  store_id text primary key, city text not null, pin text not null, area text, lat double precision, lng double precision, opened int
);
create table if not exists storesense.customers (
  customer_id text primary key, home_pin text not null references storesense.pins(pin), home_area text,
  lat double precision not null, lng double precision not null, age_band text, first_order_date date,
  nearest_store_id text references storesense.stores(store_id), nearest_store_km numeric
);
create table if not exists storesense.orders (
  order_id text primary key, customer_id text not null references storesense.customers(customer_id),
  order_date date not null, home_pin text not null references storesense.pins(pin),
  channel text not null check (channel in ('Online delivery','Store walk-in','Click & collect')),
  store_id text references storesense.stores(store_id), distance_to_store_km numeric,
  category text not null, amount_inr int not null check (amount_inr >= 0)
);
create index if not exists orders_home_pin_idx on storesense.orders(home_pin);
create index if not exists orders_store_idx on storesense.orders(store_id);

create table if not exists storesense.pin_demand (
  pin text primary key references storesense.pins(pin), name text, zone text, lat double precision, lng double precision,
  customers int, orders int, online_orders int, store_orders int, online_share numeric, revenue_inr bigint,
  orders_last_12m int, demand_index int, nearest_store_id text, nearest_store_km numeric
);
create table if not exists storesense.store_catchment (
  store_id text primary key references storesense.stores(store_id), pin text, area text, lat double precision, lng double precision,
  opened int, store_orders int, walkin_orders int, pickup_orders int, revenue_inr bigint, avg_customer_km numeric,
  p80_customer_km numeric, max_customer_km numeric, pins_served int, top_source_pins jsonb
);

alter table storesense.pins enable row level security;
alter table storesense.stores enable row level security;
alter table storesense.customers enable row level security;
alter table storesense.orders enable row level security;
alter table storesense.pin_demand enable row level security;
alter table storesense.store_catchment enable row level security;

grant usage on schema storesense to anon, authenticated, service_role;
grant select on storesense.pins, storesense.stores, storesense.pin_demand, storesense.store_catchment to anon, authenticated;
grant all on all tables in schema storesense to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storesense' and tablename='pins' and policyname='public read') then
    create policy "public read" on storesense.pins for select using (true);
    create policy "public read" on storesense.stores for select using (true);
    create policy "public read" on storesense.pin_demand for select using (true);
    create policy "public read" on storesense.store_catchment for select using (true);
  end if;
end $$;
`;

const q = (v) => (v === '' || v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const readCsv = (f) => {
  const [h, ...rows] = fs.readFileSync(path.join(root, f), 'utf8').trim().split('\n');
  const cols = h.split(',');
  return rows.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};
async function insert(table, cols, rows, numeric = [], batch = 2000) {
  for (let i = 0; i < rows.length; i += batch) {
    const values = rows.slice(i, i + batch)
      .map((r) => `(${cols.map((c) => (numeric.includes(c) && r[c] !== '' ? String(+r[c]) : c === 'top_source_pins' ? `'${JSON.stringify(r[c])}'::jsonb` : q(r[c]))).join(',')})`)
      .join(',');
    await sql(`insert into storesense.${table} (${cols.join(',')}) values ${values};`);
  }
  console.log(`  ${table}: ${rows.length}`);
}

const pins = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-pins.json'), 'utf8'));
const demand = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-demand.json'), 'utf8'));
const catchment = JSON.parse(fs.readFileSync(path.join(root, 'src/data/blr-catchment.json'), 'utf8'));
const customers = readCsv('data/generated/customers.csv');
const orders = readCsv('data/generated/orders.csv');

console.log('schema + tables');
await sql(DDL);
console.log('clearing storesense tables');
await sql('truncate storesense.orders, storesense.customers, storesense.pin_demand, storesense.store_catchment, storesense.stores, storesense.pins cascade;');
console.log('loading');
await insert('pins', ['pin', 'name', 'division', 'lat', 'lng', 'area_km2', 'distance_from_centre_km', 'zone'],
  pins.map((p) => ({ ...p, area_km2: p.areaKm2, distance_from_centre_km: p.distanceFromCentreKm })), ['lat', 'lng', 'area_km2', 'distance_from_centre_km']);
await insert('stores', ['store_id', 'city', 'pin', 'area', 'lat', 'lng', 'opened'],
  catchment.map((c) => ({ ...c, city: 'Bengaluru' })), ['lat', 'lng', 'opened']);
await insert('customers', ['customer_id', 'home_pin', 'home_area', 'lat', 'lng', 'age_band', 'first_order_date', 'nearest_store_id', 'nearest_store_km'],
  customers, ['lat', 'lng', 'nearest_store_km']);
await insert('orders', ['order_id', 'customer_id', 'order_date', 'home_pin', 'channel', 'store_id', 'distance_to_store_km', 'category', 'amount_inr'],
  orders, ['distance_to_store_km', 'amount_inr']);
await insert('pin_demand', ['pin', 'name', 'zone', 'lat', 'lng', 'customers', 'orders', 'online_orders', 'store_orders', 'online_share', 'revenue_inr', 'orders_last_12m', 'demand_index', 'nearest_store_id', 'nearest_store_km'],
  demand, ['lat', 'lng', 'customers', 'orders', 'online_orders', 'store_orders', 'online_share', 'revenue_inr', 'orders_last_12m', 'demand_index', 'nearest_store_km']);
await insert('store_catchment', ['store_id', 'pin', 'area', 'lat', 'lng', 'opened', 'store_orders', 'walkin_orders', 'pickup_orders', 'revenue_inr', 'avg_customer_km', 'p80_customer_km', 'max_customer_km', 'pins_served', 'top_source_pins'],
  catchment, ['lat', 'lng', 'opened', 'store_orders', 'walkin_orders', 'pickup_orders', 'revenue_inr', 'avg_customer_km', 'p80_customer_km', 'max_customer_km', 'pins_served']);

const check = await sql(`select (select count(*) from storesense.customers) customers, (select count(*) from storesense.orders) orders,
  (select count(*) from storesense.pin_demand) pin_demand, (select count(*) from storesense.store_catchment) catchment,
  (select sum(amount_inr) from storesense.orders) revenue;`);
console.log('db check:', check[0]);
