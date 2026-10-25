# StoreSense: Franchise Expansion Engine (AI x Ops Hackathon, Case 1)

> **How to use this file:** put it in the root of the project folder. Claude Code in the terminal reads `CLAUDE.md` automatically. Everything needed to build, test and pitch the MVP is in here.
> Team: Nanthakumar R (Nanthu) + Sanjana Pundir · Mesa School of Business · Last updated 25 Oct 2026

---

## 0. TL;DR for the builder

Build a **public web app, with no login**, where a judge:
1. uploads an Excel file (Applications and Territories sheets, in the fixed template),
2. sees a **decision for every applicant** with reasons, scores, payback and next steps,
3. sees a **demand heatmap** of pin codes with existing stores, gaps and overlap radii,
4. **chats** with the tool ("Why is APP-007 on hold?", "APP-012 found a ground-floor space") and the decision **re-runs and updates**.

**Core idea:** fund a store only when **the right place** (demand layer, Nanthu) AND **the right partner** (partner layer, Sanjana) both clear the bar. Decisions come from **fixed rules** (deterministic). AI only reads messy text and explains decisions.

**Hard deadline:** the MVP link must stay live and work without login, password or help until **Wed 28 Oct 2026, end of day IST**. Hitting a paywall, rate limit or expired session counts as a failed test.

---

## 1. Hackathon rules (what is judged)

| Criterion | Weight | Judged from |
|---|---|---|
| Problem breakdown & assumptions | 20% | Deck slides 2–4 |
| Adoption rollout | 15% | Deck slides 6–7 |
| **MVP: how well it solves the problem (not technical depth)** | **35%** | Video + MVP link with judges' test data |
| Deck communication | 10% | Deck structure, flow, visuals |
| Live presentation | 20% | Stage 2 (top 10 per section) |

**Stage 1 submission (one form per team):** a 1-min demo video link, the MVP link, and a deck of exactly 8 slides.

**How judges test the MVP:**
- Part 1: upload their own Applications and Territories sheets. Some rows are incomplete or contradictory; several compete for the same territory. **The brand never opens two stores in the same pin code.**
- Part 2: plain-language follow-ups ("Why is APP-007 on hold?") and new information ("APP-012 has now found a ground-floor space"). The decision must change sensibly.
- For every application: what happens and why; for those moving forward, next steps and how they'll be prepared to run the store.
- Judged on reasoning and clarity. There is no single right answer.

---

## 2. Test data format (judges upload this exactly)

Template: `Case1_Franchise_Test_Data_Format.xlsx` (Google Sheet id `15VjbPj9FzScS3o7imML_1l9x75bhCqGazmo-lNCzI_c`).

### ⚠️ Parser gotchas (must handle)
- **Row 1** = title banner, **Row 2** = headers, **Row 3** = grey example row (`APP-001 Ravi Kumar` / `TER-01`). **Real data starts at Row 4.** Detect the header row by matching column names; drop the example row if it is left untouched.
- **City, State and Pin code are separate columns**, even though the brief shows them merged.
- Pin codes may arrive as numbers. Normalise to 6-digit strings.
- `Pin codes covered` is comma-separated text. Split and trim.
- Optional fields may be **blank**: Current/past business, Space size, Floor, Target launch, Preferred language, Notes. Blank means a "Hold / ask for it" path, never a crash.
- Free-text columns can be messy or contradictory. Use the AI for extraction only, with a rule-based fallback.
- Judges may upload only Applications + Territories. The **Existing stores sheet is fixed**, so hard-code it as a fallback if the sheet is missing.

### Sheet 1: Applications
| Column | Format |
|---|---|
| Application ID | ID, e.g. APP-001 |
| Applicant name | text |
| City | fixed list |
| State | Karnataka |
| Pin code | 6 digits |
| Investment capacity (₹ lakh) | number |
| Retail experience (years) | number, 0 if none |
| Current / past business | free text (optional) |
| Space available | Owned / Rented / Not yet identified |
| Space size (sq ft) | number, blank if no space |
| Floor | Ground / Upper / Mall unit / Not known |
| Target launch (months) | number (optional) |
| Preferred language | Kannada / English / Hindi (optional) |
| Notes from applicant | free text (optional) |

### Sheet 2: Territories
| Column | Format |
|---|---|
| Territory ID | e.g. TER-01. **Not on applications: link by pin code** |
| City, State | fixed list |
| Pin codes covered | comma-separated 6-digit pins |
| City tier | Tier 1 / Tier 2 / Tier 3 |
| Open slots | number |
| Priority | High / Medium / Low |

### Sheet 3: Existing stores (FIXED)
| Store | City | Pin | Opened |
|---|---|---|---|
| ST-01 | Bengaluru | 560001 | 2019 |
| ST-02 | Bengaluru | 560034 | 2020 |
| ST-03 | Bengaluru | 560038 | 2021 |
| ST-04 | Bengaluru | 560066 | 2022 |
| ST-05 | Bengaluru | 560076 | 2023 |
| ST-06 | Mysuru | 570009 | 2021 |
| ST-07 | Mysuru | 570017 | 2024 |
| ST-08 | Mangaluru | 575001 | 2022 |
| ST-09 | Hubballi-Dharwad | 580020 | 2023 |
| ST-10 | Belagavi | 590001 | 2024 |

### Allowed values
| City | Pin prefix | Tier |
|---|---|---|
| Bengaluru | 560 | Tier 1 |
| Mysuru | 570 | Tier 2 |
| Mangaluru | 575 | Tier 2 |
| Hubballi-Dharwad | 580 | Tier 2 |
| Belagavi | 590 | Tier 2 |
| Tumakuru | 572 | Tier 3 (no stores yet = open market) |
| Davanagere | 577 | Tier 3 (no stores yet = open market) |

Languages: Kannada, English, Hindi.

---

## 3. Product: how it works

```
INPUTS: Applications (CRM export) · Territories · Existing stores · Demand data (simulated orders per pin)
   │
   ▼
1. READ & CLEAN ─ validate allowed values, pin↔city match, flag contradictions
   │
   ├──────────────────────────┐
   ▼                          ▼
2. DEMAND MAP (place)      3. PARTNER SCORE (person)
   heatmap, gaps,             retail readiness index
   overlap radius             (experience, relevance,
   same-pin rule              capital fit, commitment)
   │                          │
   └────────────┬─────────────┘
                ▼
4. FUND DECISION ─ payback within target, outside overlap, 3-month cash buffer
                ▼
5. MATCH & LAUNCH ─ fill competing slots by combined score, redirect the rest,
                    ADKAR gap + 60–90 day launch plan in the partner's language
                ▼
OUTPUTS: D1 decision file · D2 gap/redirect list · D3 territory fill status
         D4 partner readiness plan · D5 chat answers · D6 pilot dashboard (mock in v1)

↻ New info in chat → update the applicant record → re-run steps 1–5 → show what changed
```

### Rules that never bend
1. **Never two stores in the same pin code.** Existing stores AND newly approved applicants both count.
2. **Brand priority and open slots decide allocation.** The demand map ranks applicants within that and can flag "consider raising priority" for a zone.
3. **Deterministic:** the same input always gives the same output. The AI never makes the decision.
4. Zero retail experience is never funded without the pre-opening conditions (trained manager + mandatory training).
5. No store is approved if payback is outside the target, whatever the partner's enthusiasm.

---

## 4. Scoring rulebook (DRAFT: all numbers are tunable assumptions)

> **⚠️ SUPERSEDED (25 Oct 2026).** The numbers and decision names below are the first draft. The engine follows **`docs/rulebook.md`** (decision precedence P0–P8, fixed payback maths, partner weights summing to 100%) and **`src/config/rules.ts`** (every constant). Decision names are now **Approve / Approve with conditions / Redirect / Waitlist / Hold / Decline** ("Fund" is not used). Shared types: `src/types.ts`. Data: `src/data/ka-pins.json` (204 urban pins, 7 cities), `src/data/blr-demand.json` + `blr-catchment.json` (simulated orders, Bengaluru), test file `data/generated/StoreSense_Applicants_200.xlsx` with `applicants-edge-cases.md`.

Keep every constant in one config file (`src/config/rules.ts`) so we can tune it and show it on the assumptions slide.

### 4.1 Step 1: Read & clean → data flags
- `PIN_NOT_IN_CITY`: pin prefix doesn't match the stated city → Hold
- `PIN_NOT_IN_ANY_TERRITORY`: no territory covers the pin → Redirect to the nearest territory in the same city, else Decline ("no viable zone")
- `SPACE_CONTRADICTION`: "Owned/Rented" but no size, or "Not yet identified" but a size is given → Hold (ask)
- `MISSING_OPTIONAL`: blank language → default English and ask; blank launch → assume 6 months and ask
- `UNREALISTIC_TIMELINE`: no space + target launch < 3 months → condition
- Notes parsing (AI or regex): festival deadlines ("before Diwali"), co-investor, manager named, family business, etc.

### 4.2 Step 2: Demand map (place score 0–100)
**Simulated demand per pin** (label it clearly as *simulated online-order data*; in production this is a monthly export of orders by pin code from the order system):
```
base        = tier base (T1 70, T2 55, T3 45) adjusted by closeness to the city centre (core pins higher)
noise       = deterministic, seeded by the pin (e.g. hash(pin) % 15 - 7), NOT random per run
coverage    = distance from the pin to the nearest existing store (km, haversine on pin centroids)
unserved    = base × min(1, coverage / overlapRadius[tier])
demandScore = clamp(base + noise, 0, 100)
placeScore  = 0.5·unservedNorm + 0.3·priorityPts(High 100 / Med 60 / Low 30) + 0.2·demandScore
```
- **Overlap radius:** T1 2.5 km · T2 4 km · T3 7 km. Inside the radius of an existing/approved store → Redirect or Hold for a catchment check (not an automatic reject).
- **Same pin as an existing/approved store → blocked** → Redirect.
- **Redirect logic:** suggest the nearest pin in the same territory (else city) that is not taken, is outside every overlap radius, and has the highest unserved demand. Show its distance in km.
- Pin centroids: a pre-built JSON (`src/data/pins.json`) for all 560/570/572/575/577/580/590 pins, from the open India Post / data.gov.in pincode directory with lat/long. **No live geocoding at judge time.** Fallback for an unknown pin: the centroid of its city.

### 4.3 Step 3: Partner score (retail readiness index 0–100)
| Component | Weight | How |
|---|---|---|
| Retail experience depth | 35% | 0 yrs = 0 · 1–3 yrs = 50–70 · 4+ yrs = 85–100 (more if staff/stock handled) |
| Relevance of current business | 20% | Same/adjacent category (footwear, apparel, eyewear, optical, accessories, grocery) high; unrelated low; blank = neutral 40 |
| Capital fit | 20% | Investment capacity vs required investment for tier + space |
| Commitment & plan | 15% | Space found (Owned > Rented > none), named manager, clear opening reason |
| **Location fit** *(proposed, to make 100%)* | **10%** | Applying in their own city / local knowledge, floor quality (Ground/Mall > Upper) |

> ⚠️ Sanjana's original doc sums to 90%. The 10% "location fit" line above is a proposed fix. Confirm with the team.

**Experience tiers:** 0 yrs → fundable only with conditions (trained store manager hired before opening + mandatory pre-opening training). 1–3 yrs same category → fund with conditions. 4+ yrs → strongest.

**Partner bar:** ≥ 70 strong · 55–69 conditional · < 55 decline (unless the gap is fixable).

### 4.4 Step 4: Fund decision (payback + buffer)
| Tier | Required investment | Est. monthly revenue | Contribution margin | Monthly fixed cost |
|---|---|---|---|---|
| T1 | ₹35 L | ₹8.0 L | 25% | ₹2.5 L |
| T2 | ₹25 L | ₹5.5 L | 25% | ₹1.6 L |
| T3 | ₹15 L | ₹4.0 L | 25% | ₹1.0 L |

```
revenue      = tierRevenue × (0.7 + 0.6 × demandScore/100) × floorFactor(Ground 1.0, Mall 1.05, Upper 0.8, Not known 0.9)
annualContr  = revenue × margin × 12
payback (mo) = requiredInvestment / (annualContr / 12)
cashBuffer   = investmentCapacity − requiredInvestment  (must be ≥ 3 × monthly fixed cost, else condition)
```
- Target payback **≤ 30 months**.
- Space size: under 350 sq ft → condition (smaller format / find bigger space).
- Investment short by ≤ 30% → "Fund with conditions" (co-investor / smaller format); short by > 30% → Decline (can reapply).

### 4.5 Step 5: Match & launch
- **Combined score** = 0.5·partnerScore + 0.3·placeScore + 0.2·readiness (space ready, timeline realistic).
- For each territory: sort eligible applicants by combined score, respect **open slots** and the **same-pin rule** (approving one pin blocks it for the others). Winners → Fund / Fund with conditions. Losers → Waitlist (if viable) or Redirect (if another open gap fits them).
- Process **High priority territories first**.
- **Launch plan (60–90 days)**, personalised: the ADKAR gap (which of Awareness / Desire / Knowledge / Ability / Reinforcement is weakest), a week-by-week checklist (site → agreement → fit-out → stock → staff → training → soft launch), training language, owner and dates.
- **Calendar awareness:** Diwali 2026 ≈ 8 Nov, too close to open from late October → move to the next festive season and say so.

### 4.6 Decision states
| Decision | Meaning | Next step |
|---|---|---|
| **Fund now** | Right place, right partner, payback in target | Launch plan starts immediately |
| **Fund with conditions** | Good fit, one gap (short investment, no manager, small space) | Named condition + deadline |
| **Redirect** | Good partner, but pin taken / inside overlap radius | Offered the nearest open gap pin (with km) |
| **Waitlist** | Viable, but a stronger applicant took the last slot | First in line if a slot opens |
| **Hold** | Key info missing or contradictory | Exactly what to send, in their language |
| **Decline** | Far below minimums or no viable zone | Clear reason; can reapply |

Every decision must show its **reason codes + numbers** (partner score breakdown, place score, distance to nearest store, payback, buffer).

---

## 5. Outputs (deliverables inside the app)
- **D1 Decision file:** table with one row per application (decision, reasons, score breakdown, payback, next action). Downloadable as CSV/XLSX.
- **D2 Gap & redirect list:** open pins/territories with demand but no applicant.
- **D3 Territory fill status:** slots used/open per territory, with the reason for each slot.
- **D4 Partner readiness plan:** per approved partner, ADKAR gaps, 60–90 day checklist, language, owners, dates.
- **D5 Chat:** "why" and what-if answers with numbers. New info → re-run → show a before/after diff.
- **D6 Pilot dashboard (mock in v1):** days to open, % approved who open, override rate, nearby-store sales, 6-month survival.

### Chat behaviour (critical for judging)
- Intent types: `explain(appId)`, `update(appId, field, value)`, `whatIf(...)`, `list(filter)` ("who is on hold?"), `compare(appA, appB)`.
- For **update**: parse the change ("found a ground-floor space" → `space_available=Rented/Owned`, `floor=Ground`; ask for the size if missing) → re-run the engine for that territory (because slot allocation can shift) → reply with **old decision → new decision + why**, and mention any other applicant affected.
- Answers come from engine data (reason codes); the LLM only phrases them. **If the LLM API fails or is rate-limited → template answers.** The chat must never break.

---

## 6. Roles (v2; v1 shows a single admin view for the judges)
| Role | Sees | Can do | Can't see |
|---|---|---|---|
| Expansion head | Everything, D2/D3/D6 | Change slots/priority, approve big overrides | — |
| Expansion manager (daily user) | Queue, D1, D2, chat | Override with written note, add info | Finance settings |
| Finance | Payback, investment gap, buffer | Sign off Fund decisions | Training checklists |
| Training & ops | Approved partners only, D4 | Tick milestones, assign trainers | Rejected applicants' scores |
| Franchise partner | Own status, reason, conditions, checklist | Upload docs, ask chat, accept redirect | Others, demand map, internal scores |
| Judges (v1) | Admin view of all | Upload, ask, update | — |

---

## 7. Tech stack (v1)
| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript + Tailwind | Single-page, no login |
| Excel parsing | SheetJS (`xlsx`) in the browser | Header-row detection, example-row skip |
| Map | **Leaflet + OpenStreetMap** tiles | Free, no key. Circle markers coloured by demand, radius circles, store pins |
| Pin coordinates | Pre-built `pins.json` | From open India pincode data; no runtime API |
| Rules engine | Pure TS functions in `src/engine/` | Deterministic, unit-tested |
| AI | Serverless function `/api/chat` → Claude (or Gemini) API | Key in an env var on the server only. Template fallback |
| Hosting | **Vercel** (from a GitHub repo) | Public URL, no auth. Set a budget cap on the AI key |
| State | In-browser (React state / zustand) | No DB in v1; Supabase only in v2 |
| Testing | Vitest (engine) + Playwright (upload → decisions smoke test) | |

**Cost guardrails:** cap AI tokens per request, cache identical prompts, limit the chat to engine context only, set a spend limit on the provider dashboard.

### Suggested structure
```
/src
  /config/rules.ts          # every threshold & weight (assumptions slide = this file)
  /data/existingStores.ts   # fixed Sheet 3
  /data/pins.json           # pin → {lat, lng, city}
  /data/demand.ts           # deterministic simulated demand per pin
  /engine/parse.ts          # Excel → typed records + data flags
  /engine/place.ts          # demand, overlap, same-pin, redirect search
  /engine/partner.ts        # readiness index
  /engine/fund.ts           # payback, buffer, conditions
  /engine/allocate.ts       # slot matching per territory
  /engine/launch.ts         # ADKAR gap + 60–90 day plan
  /engine/explain.ts        # reason codes → template sentences
  /engine/index.ts          # runAll(apps, territories) → results
  /ui/...                   # Upload, DecisionTable, ApplicantDrawer, Map, Chat, TerritoryBoard
/api/chat.ts                # serverless LLM call (parse intent + phrase answer)
/test/fixtures/*.xlsx       # our own messy test files
```

---

## 8. Build order (do the core first; the heatmap comes on top)
1. `rules.ts` + `existingStores.ts` + `pins.json` + `demand.ts`
2. Parser with all the gotchas + data flags → unit tests
3. Engine: place → partner → fund → allocate → explain → unit tests
4. UI: upload → decision table → applicant detail (reasons, scores, payback, next steps, launch plan)
5. Map: heatmap + stores + radius circles + redirect suggestion
6. Chat: explain + update/re-run with diff; template fallback first, then the LLM
7. Territory board (D3), gap list (D2), CSV export (D1), mock dashboard (D6)
8. Deploy to Vercel → test from an incognito window on a phone and a laptop
9. Record the 1-minute video (Win + Alt + R)

### Test fixtures to create (mimic the judges)
- Two applicants on the **same pin**; one applicant on an **existing store pin** (e.g. 560034)
- More applicants than **open slots** in a High-priority territory
- "Owned" space with **blank size**; blank language; blank launch
- Pin that is **in no territory**; Tumakuru/Davanagere (open markets)
- 0-year experience with a big investment; 6-year footwear retailer short on investment
- "Wants to open before Diwali" with a 1-month target and no space
- Follow-ups: "Why is APP-007 on hold?" · "APP-012 has now found a ground-floor space" · "Who is waitlisted in Mysuru?"

### Acceptance checklist
- [ ] Judge's file uploads with no edits; the example row is ignored
- [ ] Every application gets a decision + reasons + next step
- [ ] Never two approved stores in one pin (incl. existing)
- [ ] Competing applicants resolved; losers redirected or waitlisted with a reason
- [ ] Chat explains any APP-ID with numbers
- [ ] Chat update changes the decision and shows before → after
- [ ] Works with the LLM switched off (template mode)
- [ ] Public link, no login, works on mobile, live till 28 Oct EOD IST

---

## 9. Deck (exactly 8 slides)
1. **Title:** both names, Case 1, MVP link, video link
2. **Problem breakdown:** who has the problem (expansion team, partners, customers), what it costs (leakage, slow openings, cannibalisation, uncovered demand), sub-problems
3. **Scope:** in: screening, geo-selection, allocation, onboarding plan, chat. Out: lease negotiation, legal docs, real payments, live CRM sync (v2)
4. **Assumptions & data:** the rulebook numbers + how each is validated (simulated demand → real order data in the pilot; radius → before/after sales; payback → current franchisees)
5. **Solution & MVP:** the one flow diagram (section 3)
6. **Adoption (ADKAR):** daily user = expansion manager. What changes: only exceptions reach them. Resistance: "a tool can't judge a partner" → visible reasons + override with note
7. **Rollout:** pilot Mysuru 4 weeks (tool vs team side by side) → all Karnataka (tool decides, team reviews exceptions) → real order data + new states. Metrics: days to open, % approved who open, override rate, nearby-store sales, 6-month survival. What happens when the tool is wrong: override + log + quarterly weight review
8. **Open slide (brownie point):** pick one. Repurpose the engine for Amazon pickup points, Delhivery centres, QSR, dark stores, cold storage. Or cost at volume (Leaflet free, AI ~cents per applicant)

**Frameworks referenced:** demand-first site selection (Lenskart), low-capital partner entry (Amazon I Have Space), SOP/phased onboarding (Delhivery), cannibalisation test, unit economics/payback, segmentation, Diffusion of Innovation (target experienced local retailers first), ADKAR (partner readiness + team adoption), 90-day hypothesis test, leading/lagging indicators, impact vs effort.

---

## 10. Industry context (for the deck and Q&A)
- **Franchise lead CRMs:** FranConnect, ClientTether, FranFunnel, SiteZeus; general CRMs (Salesforce, HubSpot, Zoho, LeadSquared). Typical journey: lead → intro call → application → disclosure docs → Discovery Day → agreement → onboarding.
- **Location intelligence:** GeoIQ (India, Lenskart is a client: footfall, demographics, rent, revenue potential), Placer.ai, Esri, CARTO, GapMaps India.
- **Order demand by pin:** the brand's own order system / e-commerce + logistics exports (Shopify, Unicommerce, Shiprocket, Delhivery).
- **Positioning:** "In India, brands run lead CRMs, order data and location tools separately. StoreSense joins them into one decision per applicant, then runs onboarding." (SiteZeus partly does this in the US, so don't claim nobody does it.)

## 11. Open decisions (confirm before building)
- [ ] AI provider: Claude (recommended) or Gemini free tier
- [ ] Hosting: Vercel (recommended)
- [ ] Map: Leaflet (recommended) or Google Maps
- [ ] Partner score 5th component (10% location fit) OK?
- [ ] Final product name: StoreSense (working)

## 12. Kick-off prompts for Claude Code
```
Read CLAUDE.md fully. Scaffold the project in section 7's structure with React+Vite+TS+Tailwind. Start with step 1–2 of the build order and write unit tests for the parser using the gotchas in section 2.
```
```
Implement the engine in /src/engine exactly per section 4, with all constants in /src/config/rules.ts. Add Vitest tests for every fixture listed in section 8.
```
```
Build the UI: upload → decision table → applicant drawer → Leaflet map → chat with template fallback. Then add /api/chat for Vercel using an env var key.
```
