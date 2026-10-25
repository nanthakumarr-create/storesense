// HubSpot CRM access for StoreSense (server-side only: the token never reaches the browser).
// Used by: scripts/hubspot-seed.mjs, the Vite dev middleware (vite.config.ts) and the Vercel function api/hubspot/[action].js.
// Applicants live as HubSpot contacts (properties prefixed ss_); decisions are pushed as deals in the "Franchise Pipeline".

const API = 'https://api.hubapi.com';
const PIPELINE_LABEL = 'Franchise Pipeline';

/** Template column → HubSpot contact property. Order = the judges' template order. */
export const APPLICATION_FIELDS = [
  ['Application ID', 'ss_application_id'],
  ['Applicant name', null], // firstname + lastname
  ['City', 'ss_city'],
  ['State', 'ss_state'],
  ['Pin code', 'ss_pin_code'],
  ['Investment capacity (₹ lakh)', 'ss_investment_lakh'],
  ['Retail experience (years)', 'ss_retail_experience_years'],
  ['Current / past business', 'ss_current_business'],
  ['Space available', 'ss_space_available'],
  ['Space size (sq ft)', 'ss_space_size_sqft'],
  ['Floor', 'ss_floor'],
  ['Target launch (months)', 'ss_target_launch_months'],
  ['Preferred language', 'ss_preferred_language'],
  ['Notes from applicant', 'ss_notes'],
];
const CONTACT_PROPS = ['firstname', 'lastname', 'ss_uid', 'ss_source_row', ...APPLICATION_FIELDS.map(([, p]) => p).filter(Boolean)];

/** Decision → pipeline stage label. */
const STAGE_FOR = {
  Approve: 'Approved',
  'Approve with conditions': 'Approved with conditions',
  Redirect: 'Redirect offered',
  Waitlist: 'Waitlist',
  Hold: 'Hold - info needed',
  Decline: 'Declined',
};

export function hubspotToken(env = process.env) {
  return env.HUBSPOT_ACCESS_TOKEN || null;
}

async function hs(token, method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1100 * (attempt + 1))); // rate limited: back off and retry
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HubSpot ${method} ${path.split('?')[0]} → ${res.status}: ${json.message || 'error'}`);
    return json;
  }
  throw new Error('HubSpot rate limit: try again in a few seconds');
}

/** Every contact that carries a StoreSense record key, via the search API (paged). */
async function searchAll(token, objectType, properties) {
  const out = [];
  let after;
  do {
    const page = await hs(token, 'POST', `/crm/v3/objects/${objectType}/search`, {
      filterGroups: [{ filters: [{ propertyName: 'ss_uid', operator: 'HAS_PROPERTY' }] }],
      properties,
      limit: 100,
      ...(after ? { after } : {}),
    });
    out.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

async function pipeline(token) {
  const { results } = await hs(token, 'GET', '/crm/v3/pipelines/deals');
  const p = results.find((x) => x.label === PIPELINE_LABEL);
  if (!p) throw new Error(`Deal pipeline "${PIPELINE_LABEL}" not found — run scripts/hubspot-setup.mjs`);
  return { id: p.id, stages: Object.fromEntries(p.stages.map((s) => [s.label, s.id])) };
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function status(token) {
  if (!token) return { connected: false, reason: 'HUBSPOT_ACCESS_TOKEN is not set on the server' };
  const [p, contacts, deals] = await Promise.all([
    pipeline(token),
    hs(token, 'POST', '/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'ss_uid', operator: 'HAS_PROPERTY' }] }], limit: 1 }),
    hs(token, 'POST', '/crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'ss_uid', operator: 'HAS_PROPERTY' }] }], limit: 1 }),
  ]);
  return { connected: true, pipeline: PIPELINE_LABEL, pipelineId: p.id, stages: Object.keys(p.stages), contacts: contacts.total, deals: deals.total };
}

/** Applicants as rows keyed by the template's column headers, in source-row order. */
export async function listApplicants(token) {
  const contacts = await searchAll(token, 'contacts', CONTACT_PROPS);
  const rows = contacts.map((c) => {
    const p = c.properties;
    const row = {};
    for (const [header, prop] of APPLICATION_FIELDS) {
      row[header] = prop ? (p[prop] ?? '') : [p.firstname, p.lastname].filter(Boolean).join(' ');
    }
    return { hubspotId: c.id, uid: p.ss_uid, sourceRow: Number(p.ss_source_row) || 0, row };
  });
  rows.sort((a, b) => a.sourceRow - b.sourceRow || a.uid.localeCompare(b.uid));
  return { headers: APPLICATION_FIELDS.map(([h]) => h), applicants: rows };
}

/** Create or update applicants (contacts), matched by ss_uid. `items`: [{uid, sourceRow, row: {header: value}}]. */
export async function upsertApplicants(token, items) {
  const existing = new Map((await searchAll(token, 'contacts', ['ss_uid'])).map((c) => [c.properties.ss_uid, c.id]));
  const toProps = ({ uid, sourceRow, row }) => {
    const [firstname, ...rest] = String(row['Applicant name'] ?? '').trim().split(/\s+/);
    const props = { firstname: firstname || '', lastname: rest.join(' '), ss_uid: uid, ss_source_row: String(sourceRow ?? '') };
    for (const [header, prop] of APPLICATION_FIELDS) if (prop) props[prop] = row[header] === null || row[header] === undefined ? '' : String(row[header]);
    return props;
  };
  const creates = items.filter((i) => !existing.has(i.uid)).map((i) => ({ properties: toProps(i) }));
  const updates = items.filter((i) => existing.has(i.uid)).map((i) => ({ id: existing.get(i.uid), properties: toProps(i) }));
  for (const c of chunks(creates, 100)) await hs(token, 'POST', '/crm/v3/objects/contacts/batch/create', { inputs: c });
  for (const c of chunks(updates, 100)) await hs(token, 'POST', '/crm/v3/objects/contacts/batch/update', { inputs: c });
  return { created: creates.length, updated: updates.length };
}

/**
 * Push engine decisions as deals in the Franchise Pipeline, one deal per applicant (matched by ss_uid),
 * associated with the applicant's contact when it exists.
 * `decisions`: [{uid, appId, name, city, decision, headline, nextStep, partnerScore, placeScore, paybackMonths, assignedPin, territoryId}]
 */
export async function pushDecisions(token, decisions, runAt = new Date().toISOString()) {
  const p = await pipeline(token);
  const [deals, contacts] = await Promise.all([searchAll(token, 'deals', ['ss_uid']), searchAll(token, 'contacts', ['ss_uid'])]);
  const dealByUid = new Map(deals.map((d) => [d.properties.ss_uid, d.id]));
  const contactByUid = new Map(contacts.map((c) => [c.properties.ss_uid, c.id]));
  const props = (d) => ({
    dealname: `${d.appId} · ${d.name} · ${d.city}`,
    pipeline: p.id,
    dealstage: p.stages[STAGE_FOR[d.decision]] ?? p.stages['Application received'],
    ss_uid: d.uid,
    ss_application_id: d.appId,
    ss_decision: d.decision,
    ss_reason: String(d.headline ?? '').slice(0, 2000),
    ss_next_step: String(d.nextStep ?? '').slice(0, 2000),
    ss_partner_score: d.partnerScore ?? '',
    ss_place_score: d.placeScore ?? '',
    ss_payback_months: d.paybackMonths ?? '',
    ss_assigned_pin: d.assignedPin ?? '',
    ss_territory_id: d.territoryId ?? '',
    ss_run_at: runAt,
  });
  const creates = decisions.filter((d) => !dealByUid.has(d.uid)).map((d) => ({
    properties: props(d),
    ...(contactByUid.has(d.uid)
      ? { associations: [{ to: { id: contactByUid.get(d.uid) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }] }
      : {}),
  }));
  const updates = decisions.filter((d) => dealByUid.has(d.uid)).map((d) => ({ id: dealByUid.get(d.uid), properties: props(d) }));
  for (const c of chunks(creates, 100)) await hs(token, 'POST', '/crm/v3/objects/deals/batch/create', { inputs: c });
  for (const c of chunks(updates, 100)) await hs(token, 'POST', '/crm/v3/objects/deals/batch/update', { inputs: c });
  const byStage = decisions.reduce((m, d) => ((m[STAGE_FOR[d.decision]] = (m[STAGE_FOR[d.decision]] || 0) + 1), m), {});
  return { created: creates.length, updated: updates.length, byStage };
}

/** Single entry point for HTTP handlers: (action, method, body) → JSON-able result. */
export async function handle(action, method, body, env = process.env) {
  const token = hubspotToken(env);
  if (action === 'status') return status(token).catch((e) => ({ connected: false, reason: e.message }));
  if (!token) throw Object.assign(new Error('HubSpot is not connected on this server'), { status: 503 });
  if (action === 'import' && method === 'POST') return listApplicants(token);
  if (action === 'push' && method === 'POST') {
    const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
    if (!decisions.length) throw Object.assign(new Error('No decisions to push'), { status: 400 });
    if (decisions.length > 1000) throw Object.assign(new Error('Too many decisions in one push (max 1000)'), { status: 400 });
    return pushDecisions(token, decisions);
  }
  throw Object.assign(new Error(`Unknown HubSpot action: ${method} ${action}`), { status: 404 });
}
