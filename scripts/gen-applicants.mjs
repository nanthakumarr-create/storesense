// Generates 200 SIMULATED franchise applicants with varied backgrounds + a Territories sheet,
// written in the exact judges' template layout (title row, header row, untouched example row, data from row 4).
// Deterministic (fixed seed). About 15% of rows carry deliberate judge-style problems; see the edge-case manifest.
// Usage: node scripts/gen-applicants.mjs
// Outputs:
//   data/generated/StoreSense_Applicants_200.xlsx   (upload-ready test file)
//   data/generated/applicants.json                   (same rows, for HubSpot seeding)
//   data/generated/applicants-edge-cases.md          (which APP IDs carry which trick)
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const root = process.cwd();
const pins = JSON.parse(fs.readFileSync(path.join(root, 'src/data/ka-pins.json'), 'utf8'));
const pinsOf = (city) => pins.filter((p) => p.city === city);

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261026);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p) => rand() < p;
const one = (arr) => arr[Math.floor(rand() * arr.length)];
const pick = (arr, w) => { let r = rand() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) if ((r -= w[i]) <= 0) return arr[i]; return arr.at(-1); };

// ---------- territories (brand's growth plan) ----------
const P = (...s) => s.map((x) => (x.length === 3 ? '560' + x : x));
const TERRITORIES = [
  ['TER-01', 'Bengaluru', P('037', '103', '048', '067', '087', '066', '036'), 'Tier 1', 2, 'High'],   // East IT corridor
  ['TER-02', 'Bengaluru', P('102', '035', '100', '068', '114', '034', '095'), 'Tier 1', 3, 'High'],   // South-East
  ['TER-03', 'Bengaluru', P('098', '072', '040', '079', '060', '010', '023'), 'Tier 1', 2, 'High'],   // West
  ['TER-04', 'Bengaluru', P('092', '064', '024', '032', '097', '112', '013'), 'Tier 1', 2, 'Medium'], // North
  ['TER-05', 'Bengaluru', P('113', '043', '016', '093', '038', '045'), 'Tier 1', 1, 'Medium'],        // North-East
  ['TER-06', 'Bengaluru', P('078', '041', '050', '061', '085', '111', '076'), 'Tier 1', 2, 'Medium'], // South
  ['TER-07', 'Bengaluru', P('001', '002', '009', '025', '051', '053', '027', '004'), 'Tier 1', 1, 'Low'], // Central
  ['TER-08', 'Mysuru', ['570001', '570009', '570017', '570023', '570030', '570011', '570019', '570015'], 'Tier 2', 2, 'High'],
  ['TER-09', 'Mangaluru', ['575001', '575002', '575003', '575004', '575006', '575008', '575020'], 'Tier 2', 1, 'Medium'],
  ['TER-10', 'Hubballi-Dharwad', ['580020', '580021', '580025', '580024', '580029', '580032'], 'Tier 2', 1, 'Medium'],
  ['TER-11', 'Hubballi-Dharwad', ['580001', '580002', '580004', '580006', '580008'], 'Tier 2', 1, 'Low'],
  ['TER-12', 'Belagavi', ['590001', '590006', '590010', '590016', '590003', '590011'], 'Tier 2', 1, 'Low'],
  ['TER-13', 'Tumakuru', ['572101', '572102', '572103', '572104', '572105', '572106'], 'Tier 3', 1, 'High'],
  ['TER-14', 'Davanagere', ['577001', '577002', '577003', '577004', '577005', '577006'], 'Tier 3', 1, 'Medium'],
  ['TER-15', 'Mysuru', ['570028', '570029', '570033', '570034'], 'Tier 2', 0, 'Low'],               // brand paused: 0 slots
].map(([id, city, pinList, tier, slots, priority]) => ({ id, city, pins: pinList, tier, slots, priority }));
const territoryPins = (city) => TERRITORIES.filter((t) => t.city === city).flatMap((t) => t.pins);
const EXISTING = { Bengaluru: P('001', '034', '038', '066', '076'), Mysuru: ['570009', '570017'], Mangaluru: ['575001'], 'Hubballi-Dharwad': ['580020'], Belagavi: ['590001'] };
const TIER_MIN = { 'Tier 1': 35, 'Tier 2': 22, 'Tier 3': 15 }; // ₹ lakh, rulebook assumption
const CITY_TIER = { Bengaluru: 'Tier 1', Mysuru: 'Tier 2', Mangaluru: 'Tier 2', 'Hubballi-Dharwad': 'Tier 2', Belagavi: 'Tier 2', Tumakuru: 'Tier 3', Davanagere: 'Tier 3' };

// ---------- names (Karnataka mix + migrants) ----------
const FIRST = {
  kannada: ['Manjunath', 'Shivakumar', 'Lakshmi', 'Kavya', 'Prakash', 'Suresh', 'Anitha', 'Deepa', 'Nagaraj', 'Basavaraj', 'Mallikarjun', 'Shwetha', 'Pooja', 'Raghavendra', 'Chethan', 'Sowmya', 'Vinay', 'Harish', 'Rekha', 'Girish', 'Bhavya', 'Santosh', 'Veena', 'Mahesh', 'Ravi', 'Yashwanth', 'Divya', 'Kiran', 'Nandini', 'Sunil'],
  coastal: ['Prashanth', 'Sandeep', 'Akshatha', 'Rakshith', 'Sneha', 'Ganesh', 'Melwyn', 'Reshma', 'Anil', 'Shilpa'],
  north: ['Rahul', 'Priya', 'Amit', 'Neha', 'Rohit', 'Anjali', 'Vikas', 'Sonal', 'Manish', 'Pallavi'],
  muslim: ['Imran', 'Ayesha', 'Faizal', 'Sameer', 'Shabana', 'Irfan', 'Nazia', 'Mohammed', 'Arshad', 'Fathima'],
  south: ['Venkatesh', 'Karthik', 'Lavanya', 'Srinivas', 'Meena', 'Arun', 'Revathi', 'Naveen', 'Harini', 'Ramesh'],
  christian: ['Joseph', 'Mary', 'Anthony', 'Grace', 'Wilson', 'Priscilla'],
};
const LAST = {
  kannada: ['Gowda', 'Patil', 'Hegde', 'Rao', 'Kulkarni', 'Shetty', 'Naik', 'Murthy', 'Desai', 'Hiremath', 'Joshi', 'Kumar', 'Prasad', 'Swamy', 'Angadi', 'Kattimani'],
  coastal: ['Shetty', 'Pai', 'Kamath', 'Rai', 'Bhat', 'Poojary', 'Shenoy', 'Alva'],
  north: ['Sharma', 'Gupta', 'Jain', 'Agarwal', 'Verma', 'Singh', 'Mehta', 'Bansal'],
  muslim: ['Khan', 'Shaikh', 'Pasha', 'Ahmed', 'Sayed', 'Basha'],
  south: ['Reddy', 'Naidu', 'Iyer', 'Pillai', 'Nair', 'Menon', 'Raju'],
  christian: ["D'Souza", 'Pinto', 'Fernandes', 'Lobo', 'Rodrigues', 'Mascarenhas'],
};
const NAME_MIX = {
  Bengaluru: [40, 2, 18, 14, 20, 6], Mysuru: [70, 0, 5, 15, 7, 3], Mangaluru: [20, 40, 3, 15, 2, 20],
  'Hubballi-Dharwad': [70, 0, 6, 18, 3, 3], Belagavi: [65, 0, 12, 15, 3, 5], Tumakuru: [80, 0, 3, 12, 5, 0], Davanagere: [80, 0, 3, 14, 3, 0],
};
const GROUPS = ['kannada', 'coastal', 'north', 'muslim', 'south', 'christian'];
function nameFor(city) {
  const g = pick(GROUPS, NAME_MIX[city]);
  return { name: `${one(FIRST[g])} ${one(LAST[g])}`, group: g };
}

// ---------- applicant backgrounds ----------
// inv = investment as a multiple of the tier minimum; space = weights [Owned, Rented, Not yet identified]
const PERSONAS = [
  { key: 'optical-owner', w: 10, yrs: [5, 22], inv: [0.8, 1.6], space: [45, 45, 10], biz: ['Runs an optical shop for {y} years', 'Own optical store, {y} yrs, do eye testing also', 'Optical & watch shop in {area}', 'opticals shop owner since {since}'] },
  { key: 'optometrist', w: 6, yrs: [0, 6], inv: [0.6, 1.3], space: [20, 50, 30], biz: ['Optometrist, works at an eye hospital', 'B.Optom, 6 yrs clinical experience', 'Runs a small eye clinic', 'Optometrist at a chain store'] },
  { key: 'ex-chain-manager', w: 8, yrs: [4, 12], inv: [0.5, 1.1], space: [5, 35, 60], biz: ['Store manager at a large eyewear chain for {y} yrs', 'Was area manager for a watch & eyewear brand', 'Retail manager, eyewear retail, {y} years', 'Ex store manager (optical chain)'] },
  { key: 'footwear-apparel', w: 12, yrs: [3, 18], inv: [0.7, 1.4], space: [40, 45, 15], biz: ['Runs a footwear store', 'Family garments shop, {y} yrs', 'Readymade clothes showroom in {area}', 'Shoe shop + bags', 'apparel retail, 2 outlets'] },
  { key: 'mobile-accessories', w: 10, yrs: [2, 10], inv: [0.5, 1.1], space: [25, 60, 15], biz: ['Mobile accessories shop', 'Mobile phones & accessories dealer', 'Runs a mobile repair and accessories store', 'mobile shop {y} yrs'] },
  { key: 'kirana-supermarket', w: 10, yrs: [5, 25], inv: [0.6, 1.3], space: [60, 35, 5], biz: ['Kirana store owner', 'Family supermarket, {y} years', 'Provision store in {area}', 'General stores (family business)'] },
  { key: 'pharmacy', w: 8, yrs: [3, 15], inv: [0.7, 1.3], space: [45, 50, 5], biz: ['Runs a medical store / pharmacy', 'Pharmacy owner, {y} yrs', 'Chemist & druggist, 2 shops', 'Medical shop near hospital'] },
  { key: 'it-professional', w: 14, yrs: [0, 0], inv: [0.9, 2.0], space: [10, 15, 75], biz: ['Software engineer, wants to start own business', 'IT professional, 12 yrs in tech', 'Working in an MNC, looking for side business', 'Product manager in a startup', ''] },
  { key: 'nri-investor', w: 5, yrs: [0, 1], inv: [1.3, 3.0], space: [30, 10, 60], biz: ['NRI, working in Dubai', 'Lives in the US, family in {city}', 'Investor, owns commercial property', 'Gulf returnee'] },
  { key: 'retired-defence', w: 5, yrs: [0, 0], inv: [0.6, 1.2], space: [30, 20, 50], biz: ['Retired Army officer', 'Ex-Air Force, retired 2024', 'Retired from Indian Navy, 22 yrs service', 'Ex-serviceman'] },
  { key: 'homemaker', w: 6, yrs: [0, 0], inv: [0.4, 0.9], space: [20, 20, 60], biz: ['Homemaker, first business', 'Housewife, husband is in govt job', '', 'Home baker, wants a proper shop'] },
  { key: 'fresh-graduate', w: 6, yrs: [0, 1], inv: [0.3, 0.8], space: [10, 10, 80], biz: ['MBA graduate 2025', 'Just finished B.Com', 'Fresh graduate, family will support', 'Final year student'] },
  { key: 'jewellery-family', w: 5, yrs: [5, 20], inv: [1.2, 2.2], space: [70, 25, 5], biz: ['Family jewellery business', 'Gold & silver jewellers, 3rd generation', 'Jewellery showroom, {y} yrs'] },
  { key: 'qsr-franchisee', w: 6, yrs: [3, 10], inv: [1.0, 1.8], space: [20, 60, 20], biz: ['Runs a pizza franchise outlet', 'Franchisee of an ice-cream brand, 2 outlets', 'Owns a QSR franchise', 'Coffee chain franchise partner'] },
  { key: 'electronics', w: 5, yrs: [4, 15], inv: [0.8, 1.5], space: [40, 55, 5], biz: ['Electronics & appliances showroom', 'Consumer electronics dealer', 'TV and home appliance store'] },
  { key: 'cafe-restaurant', w: 4, yrs: [2, 8], inv: [0.6, 1.2], space: [20, 70, 10], biz: ['Runs a cafe', 'Restaurant owner', 'Darshini (small hotel) owner'] },
  { key: 'real-estate', w: 4, yrs: [0, 2], inv: [0.9, 1.8], space: [80, 5, 15], biz: ['Real estate agent, owns a commercial building', 'Builder, has ground floor shops', 'Property dealer'] },
  { key: 'boutique', w: 5, yrs: [2, 8], inv: [0.5, 1.0], space: [25, 65, 10], biz: ['Runs a ladies boutique', 'Designer boutique + tailoring', 'Women\'s fashion store'] },
  { key: 'watch-gift', w: 4, yrs: [3, 12], inv: [0.6, 1.2], space: [30, 60, 10], biz: ['Watch showroom', 'Gift & watch shop', 'Watches and sunglasses shop', 'Sunglasses kiosk in a mall'] },
];

const NOTES = {
  any: ['Can start immediately', 'Need a bank loan for part of the investment', 'Ready to take space anywhere in the city', 'Prefer a mall location', 'Will run the store myself full-time',
    'Shop is on the main road near the bus stand', 'Looking for space near an IT park', 'Brother will co-invest 10 lakh', 'My wife will manage the store with me', 'Have a trained optometrist friend who can join',
    'Interested in 2 stores if first one does well', 'Already spoke to the area sales manager', 'Want to open before Diwali', 'Prefer to open after Sankranti', 'Family business, father will support'],
  'it-professional': ['Currently employed, will quit after approval', 'Will hire a manager initially', 'Weekend involvement only at start'],
  'nri-investor': ['Will hire a manager, I will be a passive investor', 'Relative will run it day to day', 'Visiting India in December'],
  'ex-chain-manager': ['Know the eyewear business well, need a brand', 'Can bring 2 trained staff'],
  'optical-owner': ['Want to convert my shop to the brand', 'Already have eye testing equipment'],
  'pharmacy': ['Space is next to my pharmacy', 'Space is on first floor above my pharmacy'],
  'real-estate': ['Own the building, no rent', 'Have 3 shop options in my building'],
};

const LANG_BY_GROUP = { kannada: [80, 18, 2], coastal: [55, 43, 2], north: [5, 45, 50], muslim: [40, 30, 30], south: [35, 60, 5], christian: [35, 63, 2] };
const LANGS = ['Kannada', 'English', 'Hindi'];

// ---------- generate ----------
const CITY_COUNTS = [['Bengaluru', 140], ['Mysuru', 18], ['Mangaluru', 10], ['Hubballi-Dharwad', 10], ['Belagavi', 7], ['Tumakuru', 8], ['Davanagere', 7]];
const cities = CITY_COUNTS.flatMap(([c, n]) => Array(n).fill(c));
// Interleave cities deterministically so IDs are not grouped by city
for (let i = cities.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cities[i], cities[j]] = [cities[j], cities[i]]; }

const apps = cities.map((city, i) => {
  const id = 'APP-' + String(i + 1).padStart(3, '0');
  const persona = pick(PERSONAS, PERSONAS.map((p) => p.w));
  const { name, group } = nameFor(city);
  const tier = CITY_TIER[city];
  // Pin: mostly inside a territory, sometimes elsewhere in the city
  const terr = territoryPins(city);
  const terrPin = terr.length && chance(0.85) ? one(terr) : null;
  const pinRec = terrPin ? pins.find((p) => p.pin === terrPin) : one(pinsOf(city));
  const y = int(...persona.yrs);
  const inv = Math.max(3, Math.round(TIER_MIN[tier] * (persona.inv[0] + rand() * (persona.inv[1] - persona.inv[0]))));
  const space = pick(['Owned', 'Rented', 'Not yet identified'], persona.space);
  const hasSpace = space !== 'Not yet identified';
  const size = hasSpace ? Math.round(int(persona.key === 'kirana-supermarket' ? 300 : 180, persona.key === 'real-estate' ? 1500 : 1100) / 10) * 10 : '';
  const floor = hasSpace ? pick(['Ground', 'Upper', 'Mall unit', 'Not known'], [62, 20, 10, 8]) : chance(0.7) ? 'Not known' : '';
  const launch = chance(0.08) ? '' : hasSpace ? int(2, 6) : int(3, 12);
  const lang = chance(0.07) ? '' : pick(LANGS, LANG_BY_GROUP[group]);
  const biz = chance(0.05) ? '' : one(persona.biz).replace('{y}', y).replace('{since}', 2026 - y).replace('{area}', pinRec.name).replace('{city}', city);
  const notePool = [...NOTES.any, ...(NOTES[persona.key] || [])];
  const notes = chance(0.3) ? '' : chance(0.25) ? `${one(notePool)}. ${one(NOTES.any)}` : one(notePool);
  return {
    id, name, city, state: 'Karnataka', pin: Number(pinRec.pin), investment: inv, experience: y, business: biz,
    space, size, floor, launch, language: lang, notes, persona: persona.key, tricks: [],
  };
});

// ---------- deliberate judge-style problems (fixed rows) ----------
const at = (n) => apps[n - 1];
const trick = (n, label, patch) => { Object.assign(at(n), patch); at(n).tricks.push(label); };
const blrPin = (s) => Number('560' + s);

// Space contradictions
[7, 41, 88, 133].forEach((n) => trick(n, 'Owned/Rented but space size blank', { space: n % 2 ? 'Owned' : 'Rented', size: '', floor: 'Ground' }));
[19, 102, 171].forEach((n) => trick(n, 'Space "Not yet identified" but size given', { space: 'Not yet identified', size: 450, floor: 'Not known' }));
trick(56, 'Notes contradict space field (Rented but still searching)', { space: 'Rented', size: 400, floor: 'Ground', notes: 'Still searching for a good shop, broker showing options' });
trick(147, 'Notes contradict floor (Ground but notes say first floor)', { space: 'Rented', size: 500, floor: 'Ground', notes: 'Shop is on the first floor, stairs from main road' });
// Pin / city problems
trick(13, 'Pin does not match city (Mysuru with Bengaluru pin)', { city: 'Mysuru', pin: blrPin('102') });
trick(64, 'Pin does not match city (Bengaluru with Mangaluru pin)', { city: 'Bengaluru', pin: 575002 });
trick(119, 'Pin does not match city (Belagavi with Hubballi pin)', { city: 'Belagavi', pin: 580021 });
trick(190, 'Pin in no territory (Bengaluru airport)', { city: 'Bengaluru', pin: 560300 });
trick(33, 'Pin in no territory (Bengaluru, 560012)', { city: 'Bengaluru', pin: 560012 });
trick(141, 'Pin in no territory (Mangaluru outskirts)', { city: 'Mangaluru', pin: 575010 });
trick(77, 'Pin typed as text with a space', { city: 'Bengaluru', pin: '560 037' });
trick(158, 'Pin with leading/trailing spaces', { city: 'Bengaluru', pin: ' 560103 ' });
// Same pin as an existing store
[[23, 'Bengaluru', 560034], [91, 'Bengaluru', 560038], [128, 'Mysuru', 570009], [166, 'Mangaluru', 575001], [184, 'Hubballi-Dharwad', 580020]]
  .forEach(([n, city, pin]) => trick(n, `Same pin as existing store (${pin})`, { city, pin }));
// Head-to-head clashes on one pin (strong vs strong)
trick(3, 'Clash on 560037 with APP-045 (both strong)', { city: 'Bengaluru', pin: 560037, persona: 'optical-owner', experience: 11, investment: 48, business: 'Runs an optical shop for 11 years', space: 'Rented', size: 650, floor: 'Ground', launch: 3 });
trick(45, 'Clash on 560037 with APP-003 (both strong)', { city: 'Bengaluru', pin: 560037, persona: 'ex-chain-manager', experience: 8, investment: 42, business: 'Store manager at a large eyewear chain for 8 yrs', space: 'Owned', size: 520, floor: 'Ground', launch: 4 });
trick(99, 'Clash on 572101 Tumakuru (1 slot) with APP-150', { city: 'Tumakuru', pin: 572101, experience: 6, investment: 18, space: 'Owned', size: 600, floor: 'Ground', launch: 3 });
trick(150, 'Clash on 572101 Tumakuru (1 slot) with APP-099', { city: 'Tumakuru', pin: 572101, experience: 2, investment: 25, space: 'Rented', size: 420, floor: 'Ground', launch: 2 });
trick(70, 'Applies in TER-15 (0 open slots)', { city: 'Mysuru', pin: 570029 });
// Number formatting problems
trick(28, 'Investment typed as text "30 lakh"', { investment: '30 lakh' });
trick(116, 'Investment typed as text "₹25L"', { investment: '₹25L' });
trick(137, 'Experience typed as text "5 yrs"', { experience: '5 yrs' });
// Language problems
trick(52, 'Language not in allowed list (Tamil)', { language: 'Tamil' });
trick(175, 'Two languages in one cell', { language: 'Kannada / Hindi' });
// Profiles that test the rules
trick(15, '0 years retail, very large investment', { experience: 0, investment: 95, business: 'IT professional, 15 yrs in tech', persona: 'it-professional', space: 'Not yet identified', size: '', floor: 'Not known' });
trick(160, '0 years retail, very large investment, passive', { experience: 0, investment: 120, business: 'NRI, working in Dubai', persona: 'nri-investor', notes: 'Will hire a manager, I will be a passive investor' });
trick(38, '6-yr footwear retailer, short on investment', { city: 'Bengaluru', pin: 560098, experience: 6, investment: 24, business: 'Runs a footwear store for 6 years', persona: 'footwear-apparel', space: 'Rented', size: 480, floor: 'Ground', launch: 3 });
trick(81, 'Wants Diwali opening, 1-month target, no space', { space: 'Not yet identified', size: '', floor: 'Not known', launch: 1, notes: 'Wants to open before Diwali' });
trick(123, 'Wants Diwali opening, has space, 1-month target', { space: 'Rented', size: 550, floor: 'Ground', launch: 1, notes: 'Must open before Diwali, festival season is key' });
trick(61, 'Tiny space (150 sq ft) on upper floor', { space: 'Rented', size: 150, floor: 'Upper' });
trick(108, 'Investment far below minimum', { investment: 6, experience: 1, business: 'Final year student' });
// Duplicate Application ID
trick(200, 'Duplicate Application ID (same as APP-199)', { id: 'APP-199' });
// The brief's example IDs: APP-007 (Owned, size blank, above) should be on Hold;
// APP-012 is a solid Bengaluru partner with no space yet, so "found a ground-floor space" moves them forward.
trick(12, 'Brief example: "APP-012 has now found a ground-floor space" (no space yet)', {
  city: 'Bengaluru', pin: 560100, experience: 7, investment: 40, persona: 'footwear-apparel', business: 'Family garments shop, 7 yrs',
  space: 'Not yet identified', size: '', floor: 'Not known', launch: 4, language: 'Kannada', notes: 'Looking for space near an IT park',
});

// ---------- write workbook in template layout ----------
const tpl = XLSX.read(fs.readFileSync(path.join(root, 'data/template/Case1_Franchise_Test_Data_Format.xlsx')));
const APP_HEADERS = ['Application ID', 'Applicant name', 'City', 'State', 'Pin code', 'Investment capacity (₹ lakh)', 'Retail experience (years)', 'Current / past business', 'Space available', 'Space size (sq ft)', 'Floor', 'Target launch (months)', 'Preferred language', 'Notes from applicant'];
const TER_HEADERS = ['Territory ID', 'City', 'State', 'Pin codes covered', 'City tier', 'Open slots', 'Priority'];
const appRows = apps.map((a) => [a.id, a.name, a.city, a.state, a.pin, a.investment, a.experience, a.business, a.space, a.size, a.floor, a.launch, a.language, a.notes]);
// One blank row in the middle, as real exports often have
appRows.splice(120, 0, Array(APP_HEADERS.length).fill(''));
const terRows = TERRITORIES.map((t) => [t.id, t.city, 'Karnataka', t.pins.join(', '), t.tier, t.slots, t.priority]);

const sheet = (title, headers, example, rows) => XLSX.utils.aoa_to_sheet([[title], headers, example, ...rows]);
tpl.Sheets.Applications = sheet('Applications — one row per record. Row 3 is an example (grey); enter data from row 4.', APP_HEADERS,
  ['APP-001', 'Ravi Kumar', 'Mysuru', 'Karnataka', 570001, 25, 4, 'Runs a footwear store', 'Rented', 450, 'Ground', 3, 'Kannada', 'Wants to open before Diwali'], appRows);
tpl.Sheets.Territories = sheet('Territories — one row per record. Row 3 is an example (grey); enter data from row 4.', TER_HEADERS,
  ['TER-01', 'Mysuru', 'Karnataka', '570001, 570002, 570008', 'Tier 2', 3, 'High'], terRows);
fs.mkdirSync(path.join(root, 'data/generated'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/generated/StoreSense_Applicants_200.xlsx'), XLSX.write(tpl, { type: 'buffer', bookType: 'xlsx' }));
fs.writeFileSync(path.join(root, 'data/generated/applicants.json'), JSON.stringify({ applicants: apps, territories: TERRITORIES }, null, 1));

const manifest = ['# Applicant test file: deliberate problems', '', 'Generated by `scripts/gen-applicants.mjs` (seed 20261026). All people are simulated.', '',
  '| Application | City | Pin | Trick |', '|---|---|---|---|',
  ...apps.filter((a) => a.tricks.length).map((a) => `| ${a.id} | ${a.city} | ${String(a.pin).trim()} | ${a.tricks.join('; ')} |`),
  '', 'Also: one fully blank row after the 120th applicant; the template example row (APP-001 Ravi Kumar) is left untouched in row 3.'].join('\n');
fs.writeFileSync(path.join(root, 'data/generated/applicants-edge-cases.md'), manifest + '\n');

// ---------- summary ----------
const count = (f) => apps.reduce((m, a) => ((m[f(a)] = (m[f(a)] || 0) + 1), m), {});
console.log('applicants', apps.length, 'territories', TERRITORIES.length, 'open slots', TERRITORIES.reduce((s, t) => s + t.slots, 0));
console.log('by city', count((a) => a.city));
console.log('by background', count((a) => a.persona));
console.log('space', count((a) => a.space), 'language', count((a) => a.language || '(blank)'));
console.log('0-yr experience', apps.filter((a) => a.experience === 0).length, '| rows with tricks', apps.filter((a) => a.tricks.length).length);
