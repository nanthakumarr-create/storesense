// Loads the 200 simulated applicants into HubSpot as contacts (idempotent: matched by ss_uid).
// Values are written exactly as in the applicant file, messy text included, so importing them back
// into StoreSense exercises the same cleaning as an Excel upload.
// Usage: HUBSPOT_ACCESS_TOKEN=pat-... node scripts/hubspot-seed.mjs
import fs from 'node:fs';
import { upsertApplicants, status } from '../api/_lib/hubspot.js';

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN not set');
const { applicants } = JSON.parse(fs.readFileSync('data/generated/applicants.json', 'utf8'));

// Excel row of each applicant in StoreSense_Applicants_200.xlsx: data starts at row 4, one blank row after the 120th.
const excelRow = (i) => 4 + i + (i >= 120 ? 1 : 0);
const seen = new Set();
const items = applicants.map((a, i) => {
  const row = excelRow(i);
  // Same key the parser uses: the Application ID, or "APP-199#row205" when the ID repeats
  const uid = seen.has(a.id) ? `${a.id}#row${row}` : a.id;
  seen.add(a.id);
  return {
    uid,
    sourceRow: row,
    row: {
      'Application ID': a.id, 'Applicant name': a.name, City: a.city, State: a.state, 'Pin code': a.pin,
      'Investment capacity (₹ lakh)': a.investment, 'Retail experience (years)': a.experience, 'Current / past business': a.business,
      'Space available': a.space, 'Space size (sq ft)': a.size, Floor: a.floor, 'Target launch (months)': a.launch,
      'Preferred language': a.language, 'Notes from applicant': a.notes,
    },
  };
});

console.log('upserting', items.length, 'applicants…');
console.log(await upsertApplicants(token, items));
console.log(await status(token));
