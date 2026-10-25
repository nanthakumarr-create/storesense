// Loads src/data/blr-potential.json into Supabase storesense.pin_potential (public read-only).
// Idempotent: creates the table if missing, replaces its rows. Run after scripts/gen-potential.mjs.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/supabase-load-potential.mjs
import fs from 'node:fs';

const REF = 'drgpjdemhlawwzbwxkfy';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN not set');
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
const { meta, pins } = JSON.parse(fs.readFileSync('src/data/blr-potential.json', 'utf8'));
const NUM = ['lat', 'lng', 'nearest_store_km', 'missed_orders_month', 'missed_sales_lakh_month', 'redirected_orders_month', 'online_orders_month', 'store_orders_month',
  'catchment_customers', 'potential_orders_month', 'incremental_orders_month', 'cannibalised_orders_month', 'capacity_orders_month', 'capacity_use_pct',
  'est_sales_lakh_month', 'est_profit_lakh_month', 'payback_months', 'annual_roi_pct', 'opportunity_index'];
const JSONB = ['redirected_to', 'cannibalised_from'];
const TEXT = ['pin', 'name', 'zone', 'nearest_store_id', 'verdict'];
await sql(`
create table if not exists storesense.pin_potential (
  pin text primary key references storesense.pins(pin), name text, zone text, nearest_store_id text, verdict text,
  ${NUM.map((c) => `${c} numeric`).join(', ')}, ${JSONB.map((c) => `${c} jsonb`).join(', ')}
);
create table if not exists storesense.model_meta (key text primary key, value jsonb);
alter table storesense.pin_potential enable row level security;
alter table storesense.model_meta enable row level security;
grant select on storesense.pin_potential, storesense.model_meta to anon, authenticated;
grant all on storesense.pin_potential, storesense.model_meta to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storesense' and tablename='pin_potential') then
    create policy "public read" on storesense.pin_potential for select using (true);
    create policy "public read" on storesense.model_meta for select using (true);
  end if;
end $$;
truncate storesense.pin_potential;`);
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const cols = [...TEXT, ...NUM, ...JSONB];
const values = pins.map((p) => `(${[...TEXT.map((c) => q(p[c])), ...NUM.map((c) => (p[c] === null ? 'null' : String(p[c]))), ...JSONB.map((c) => `${q(JSON.stringify(p[c]))}::jsonb`)].join(',')})`).join(',');
await sql(`insert into storesense.pin_potential (${cols.join(',')}) values ${values};`);
await sql(`insert into storesense.model_meta (key, value) values ('potential', ${q(JSON.stringify(meta))}::jsonb) on conflict (key) do update set value = excluded.value;`);
console.log('pin_potential rows:', (await sql('select count(*)::int n from storesense.pin_potential'))[0].n);
