// Builds pin data for the 7 case cities from OpenCity's "India Pin Code Maps 2025" KML
// (public domain, source data.gov.in): https://data.opencity.in/dataset/india-pincode-maps-2025
// Works with the All-India KML (unzipped from the .kmz) or the Bengaluru-only KML.
// Usage: node scripts/build-pins.mjs <path-to-kml>
// Outputs:
//   src/data/ka-pins.json, public/ka-pins.geojson    (urban pins of all 7 cities)
//   src/data/blr-pins.json, public/blr-pins.geojson  (Bengaluru only, used by the customer simulation)
import fs from 'node:fs';
import path from 'node:path';

const kmlPath = process.argv[2];
if (!kmlPath) throw new Error('usage: node scripts/build-pins.mjs <kml>');
const kml = fs.readFileSync(kmlPath, 'utf8');

// Prefix → city. Each prefix covers a whole postal district, so non-Bengaluru cities keep only
// pins whose centroid is within `urbanKm` of a city centre. Existing-store pins are always kept.
const CITIES = [
  { city: 'Bengaluru', prefix: '560', tier: 'Tier 1', centres: [{ lat: 12.9794, lng: 77.5907 }], urbanKm: Infinity },
  { city: 'Mysuru', prefix: '570', tier: 'Tier 2', centres: [{ lat: 12.3052, lng: 76.6552 }], urbanKm: 12 },
  { city: 'Tumakuru', prefix: '572', tier: 'Tier 3', centres: [{ lat: 13.3409, lng: 77.101 }], urbanKm: 10 },
  { city: 'Mangaluru', prefix: '575', tier: 'Tier 2', centres: [{ lat: 12.8698, lng: 74.843 }], urbanKm: 12 },
  { city: 'Davanagere', prefix: '577', tier: 'Tier 3', centres: [{ lat: 14.4644, lng: 75.9218 }], urbanKm: 10 },
  { city: 'Hubballi-Dharwad', prefix: '580', tier: 'Tier 2', centres: [{ lat: 15.3647, lng: 75.124 }, { lat: 15.4589, lng: 75.0078 }], urbanKm: 12 },
  { city: 'Belagavi', prefix: '590', tier: 'Tier 2', centres: [{ lat: 15.8497, lng: 74.4977 }], urbanKm: 10 },
];
const STORE_PINS = new Set(['560001', '560034', '560038', '560066', '560076', '570009', '570017', '575001', '580020', '590001']);

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export const haversineKm = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Shoelace area + centroid on an equirectangular projection around the ring (fine at city scale)
function ringStats(ring) {
  const lat0 = rad(ring[0][1]);
  const kx = R * Math.cos(lat0) * (Math.PI / 180), ky = R * (Math.PI / 180);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = [ring[i][0] * kx, ring[i][1] * ky];
    const [x1, y1] = [ring[i + 1][0] * kx, ring[i + 1][1] * ky];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return { areaKm2: Math.abs(a), lng: cx / (6 * a) / kx, lat: cy / (6 * a) / ky };
}

// Keep roughly every nth point so the boundary file stays small for mobile
function simplify(ring, maxPts = 60) {
  const step = Math.max(1, Math.floor(ring.length / maxPts));
  const out = ring.filter((_, i) => i % step === 0).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
  out.push(out[0]);
  return out;
}

const byPin = new Map();
for (const pm of kml.split('<Placemark').slice(1)) {
  const pin = (pm.match(/name="Pincode">\s*(\d{6})/) || [])[1];
  const cfg = pin && CITIES.find((c) => pin.startsWith(c.prefix));
  if (!cfg) continue;
  const office = (pm.match(/name="Office_Name">([^<]*)/) || [])[1]?.trim() ?? '';
  const division = (pm.match(/name="Division">([^<]*)/) || [])[1]?.trim() ?? '';
  // Outer rings only; holes are ignored (negligible at this scale)
  const rings = [...pm.matchAll(/<outerBoundaryIs>\s*<LinearRing>\s*<coordinates>([^<]+)<\/coordinates>/g)].map((m) =>
    m[1].trim().split(/\s+/).map((p) => p.split(',').slice(0, 2).map(Number)),
  );
  if (!rings.length) continue;
  const entry = byPin.get(pin) ?? { pin, cfg, office, division, rings: [] };
  entry.rings.push(...rings);
  byPin.set(pin, entry);
}

const pins = [];
const features = [];
for (const { pin, cfg, office, division, rings } of [...byPin.values()].sort((a, b) => a.pin.localeCompare(b.pin))) {
  const stats = rings.map(ringStats);
  const area = stats.reduce((s, r) => s + r.areaKm2, 0);
  const lat = stats.reduce((s, r) => s + r.lat * r.areaKm2, 0) / area;
  const lng = stats.reduce((s, r) => s + r.lng * r.areaKm2, 0) / area;
  const distanceFromCentreKm = Math.min(...cfg.centres.map((c) => haversineKm(c, { lat, lng })));
  if (distanceFromCentreKm > cfg.urbanKm && !STORE_PINS.has(pin)) continue;
  // Zone bands scale with city size: Bengaluru 5/12 km, others 3/7 km
  const [coreKm, innerKm] = cfg.city === 'Bengaluru' ? [5, 12] : [3, 7];
  const zone = distanceFromCentreKm < coreKm ? 'core' : distanceFromCentreKm < innerKm ? 'inner' : 'outer';
  pins.push({
    pin,
    city: cfg.city,
    tier: cfg.tier,
    name: office.replace(/\s*\(.*\)\s*$/, '').replace(/\s+(S\.O|H\.O|B\.O|G\.P\.O\.?)\.?$/i, '').trim(),
    division,
    lat: +lat.toFixed(5),
    lng: +lng.toFixed(5),
    areaKm2: +area.toFixed(2),
    distanceFromCentreKm: +distanceFromCentreKm.toFixed(2),
    zone,
  });
  features.push({
    type: 'Feature',
    properties: { pin, city: cfg.city },
    geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [simplify(r)]) },
  });
}

const root = process.cwd();
fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
const write = (name, list, feats) => {
  fs.writeFileSync(path.join(root, `src/data/${name}.json`), JSON.stringify(list, null, 1));
  fs.writeFileSync(path.join(root, `public/${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features: feats }));
};
write('ka-pins', pins, features);
// Bengaluru-only file keeps the original shape (no city/tier) for the customer simulation
const blr = pins.filter((p) => p.city === 'Bengaluru').map(({ city, tier, ...rest }) => rest);
write('blr-pins', blr, features.filter((f) => f.properties.city === 'Bengaluru').map((f) => ({ ...f, properties: { pin: f.properties.pin } })));

const byCity = pins.reduce((m, p) => ((m[p.city] = (m[p.city] || 0) + 1), m), {});
console.log(`pins: ${pins.length}`, byCity);
const missing = [...STORE_PINS].filter((s) => !pins.some((p) => p.pin === s));
console.log('existing-store pins missing:', missing.length ? missing : 'none');
