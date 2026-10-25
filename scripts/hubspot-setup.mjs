// One-time, idempotent HubSpot setup for StoreSense.
// Creates: contact property group + applicant fields, deal fields for decisions,
// and the "Franchise Pipeline" with one stage per decision state.
// Usage: HUBSPOT_ACCESS_TOKEN=pat-... node scripts/hubspot-setup.mjs
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) throw new Error('HUBSPOT_ACCESS_TOKEN not set');
const API = 'https://api.hubapi.com';

async function hs(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const opts = (...labels) => labels.map((l, i) => ({ label: l, value: l, displayOrder: i }));
const GROUP = 'storesense';

const CONTACT_PROPS = [
  ['ss_application_id', 'Application ID', 'string', 'text'],
  ['ss_city', 'Store city', 'string', 'text'],
  ['ss_state', 'Store state', 'string', 'text'],
  ['ss_pin_code', 'Store pin code', 'string', 'text'],
  // Applicant answers are kept exactly as typed (e.g. "30 lakh"); StoreSense cleans them, not the CRM.
  ['ss_investment_lakh', 'Investment capacity (₹ lakh)', 'string', 'text'],
  ['ss_retail_experience_years', 'Retail experience (years)', 'string', 'text'],
  ['ss_current_business', 'Current / past business', 'string', 'textarea'],
  ['ss_space_available', 'Space available', 'enumeration', 'select', opts('Owned', 'Rented', 'Not yet identified')],
  ['ss_space_size_sqft', 'Space size (sq ft)', 'string', 'text'],
  ['ss_floor', 'Floor', 'enumeration', 'select', opts('Ground', 'Upper', 'Mall unit', 'Not known')],
  ['ss_target_launch_months', 'Target launch (months)', 'string', 'text'],
  ['ss_uid', 'StoreSense record key', 'string', 'text'],
  ['ss_source_row', 'Source row', 'number', 'number'],
  ['ss_preferred_language', 'Training language (StoreSense)', 'string', 'text'],
  ['ss_notes', 'Notes from applicant', 'string', 'textarea'],
];

const DEAL_PROPS = [
  ['ss_application_id', 'Application ID', 'string', 'text'],
  ['ss_uid', 'StoreSense record key', 'string', 'text'],
  ['ss_decision', 'StoreSense decision', 'string', 'text'],
  ['ss_reason', 'Decision reason', 'string', 'textarea'],
  ['ss_next_step', 'StoreSense next step', 'string', 'textarea'],
  ['ss_partner_score', 'Partner score', 'number', 'number'],
  ['ss_place_score', 'Place score', 'number', 'number'],
  ['ss_payback_months', 'Payback (months)', 'number', 'number'],
  ['ss_assigned_pin', 'Assigned pin code', 'string', 'text'],
  ['ss_territory_id', 'Territory ID', 'string', 'text'],
  ['ss_run_at', 'Last StoreSense run', 'string', 'text'],
];

const STAGES = [
  ['Application received', 0.1, false],
  ['Hold - info needed', 0.2, false],
  ['Waitlist', 0.3, false],
  ['Redirect offered', 0.4, false],
  ['Approved with conditions', 0.7, false],
  ['Approved', 0.9, false],
  ['Declined', 0.0, true],
];

async function ensureGroup(objectType) {
  const r = await hs('POST', `/crm/v3/properties/${objectType}/groups`, { name: GROUP, label: 'StoreSense', displayOrder: -1 });
  console.log(`group ${objectType}:`, r.status === 201 ? 'created' : r.status === 409 ? 'exists' : `${r.status} ${r.json.message}`);
}

async function ensureProps(objectType, props) {
  for (const [name, label, type, fieldType, options] of props) {
    let r = await hs('POST', `/crm/v3/properties/${objectType}`, { name, label, type, fieldType, groupName: GROUP, ...(options ? { options } : {}) });
    // Already exists: bring its type in line (e.g. number → text for raw applicant answers)
    if (r.status === 409 && !options) r = await hs('PATCH', `/crm/v3/properties/${objectType}/${name}`, { type, fieldType });
    if (![200, 201, 409].includes(r.status)) console.log(`  ${objectType}.${name}: ${r.status} ${r.json.message}`);
  }
  console.log(`props ${objectType}: ${props.length} ensured`);
}

async function ensurePipeline() {
  const list = await hs('GET', '/crm/v3/pipelines/deals');
  const existing = (list.json.results || []).find((p) => p.label === 'Franchise Pipeline');
  if (existing) return console.log('pipeline: exists', existing.id);
  const r = await hs('POST', '/crm/v3/pipelines/deals', {
    label: 'Franchise Pipeline',
    displayOrder: 1,
    stages: STAGES.map(([label, probability, isClosed], i) => ({
      label, displayOrder: i, metadata: { probability: String(probability), isClosed: String(isClosed) },
    })),
  });
  console.log('pipeline:', r.status === 201 ? `created ${r.json.id}` : `${r.status} ${r.json.message}`);
}

await ensureGroup('contacts');
await ensureGroup('deals');
await ensureProps('contacts', CONTACT_PROPS);
await ensureProps('deals', DEAL_PROPS);
await ensurePipeline();
