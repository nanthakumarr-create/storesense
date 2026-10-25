# StoreSense rulebook v2 (supersedes CLAUDE.md section 4)

Source of truth for numbers: src/config/rules.ts. This doc explains the logic and the decision precedence.

> The brand is an **eyewear** retailer (Lenskart-like, shown as "StoreSense Eyewear (simulated)"). Category relevance therefore follows `RELEVANCE_KEYWORDS` in rules.ts (optical/eyewear/optometry = same category; footwear, apparel, pharmacy, mobile, jewellery, kirana… = adjacent), not the footwear list in the table below. Where this doc and rules.ts disagree on a number, rules.ts wins.
> Demand: Bengaluru pins use `src/data/blr-demand.json` (simulated orders, `demand_index` 0–100, demandSource 'orders'); other cities use the proxy below (demandSource 'proxy').

## Rulebook

All numbers are assumptions to check against the 10 existing stores. Label them that way on slide 4.

**Fixed date:** `AS_OF_DATE = 2026-10-25`, shown in the app header.

**Viability check** (renamed from "Fund decision"). Contribution margin is 35%: about 45% gross margin minus about 10% variable costs.

| Tier | Investment | Base sales per month | Fixed cost per month | Total cash need (investment + 3 × fixed) |
|---|---|---|---|---|
| T1 | ₹35L | ₹9.5L | ₹1.9L | ₹40.7L |
| T2 | **₹22L** (was ₹25L) | ₹6.0L | ₹1.2L | ₹25.6L |
| T3 | ₹15L | ₹4.2L | ₹0.84L | ₹17.5L |

- sales = base × (0.7 + 0.6 × demand/100) × floor factor (Ground 1.0, Mall 1.05, Upper 0.8, Not known 0.9).
- Mall units also add 25% to fixed cost, so malls don't always look best.
- profit = sales × 0.35 − fixed cost.
- If profit ≤ 0, decline this site. Otherwise payback = investment ÷ profit, and it must be **≤ 30 months**.
- Checked results:

| Tier | Ground floor at tier-base demand | Upper floor |
|---|---|---|
| T1 | 19.2 months (pass) | 32.4 months (fail) |
| T2 | 22.8 months (pass) | 41.5 months (fail) |
| T3 | 25.6 months (pass) | 49.8 months (fail) |

- Capital gap is measured against the **total cash need**:

| Gap | Result |
|---|---|
| 0 | Pass |
| up to 15% | Condition: loan sanction or co-investor proof within 30 days |
| 15–30% | Condition only if a smaller or cheaper option exists, else Waitlist |
| over 30% | Decline, can reapply |

- Space size: 400+ sq ft is fine. 300–399 is a compact-format condition. Under 300 is treated as no site.

**Demand proxy (no noise):**
- demand = tier base (T1 70, T2 55, T3 45) + 10 if the pin is within 3 km of a hard-coded city centre.
- unservedNorm = 100 × min(1, distance to nearest store ÷ radius).
- placeScore = 0.6 × unservedNorm + 0.4 × demand. Priority comes out of the place score; it only orders territories.
- Label it "Demand proxy v1, replaced by order data per pin in the pilot."

**Partner score (adds up to 100):**

| Component | Weight | How it is scored |
|---|---|---|
| Experience | 35% | 0→0, 1→50, 2→60, 3→70, 4→85, then +3 per year, capped at 100 |
| Relevance | 20% | Same category (shoe, footwear, chappal, apparel, garment, boutique, optical, eyewear, bag) 100; adjacent (accessor, mobile, kirana, grocery, supermarket) 70; unrelated 25; blank 40 |
| Commitment | 20% | 60% for space (Owned 100 / Rented 85 / none 30) + 40% for a named manager or co-investor in the notes (regex) |
| Capital fit | 15% | 100 if capacity ≥ total need, falling straight to 0 at 70% of total need |
| Owner involvement | 10% | From the notes: "run it myself", "family", "local" score high; "passive" or "NRI" score low; blank = 50 |

- The floor is **not** in the partner score.
- Bar: 70 or more is strong, 55–69 is conditional, under 55 is Decline.
- **0-year path:** score ≥ 45, capacity ≥ total need, and the place and payback checks pass → Approve with conditions: hire a store manager with 2+ years before fit-out ends, plus 4 weeks of training and shadowing.

**Combined score:**
- combined = 0.5 × partner + 0.3 × place + 0.2 × readiness.
- readiness = 50 (floor is Ground or Mall) + 50 (target launch ≥ the plan's minimum length). Space is counted only in Commitment, not here.
- Round scores to 0.01.
- Ties break on: partner score → investment → experience → Application ID → row number.

**Decision order (first match wins):**
- **P0:** skip blank rows, drop the untouched example row, rename and flag duplicate IDs.
- **P1:** a required field is invalid or can't be parsed, or the pin doesn't match the city → **Hold**. Suggest the city that matches the pin prefix.
- **P2:** partner below the bar (and not on the 0-year path), or capital gap over 30% → **Decline**.
- **P3:** pin is in no territory → **Waitlist (no territory yet)** and list the pin in D2 as "consider opening a territory".
- **P4:** same pin as an existing store or a pin already taken in this run → **Redirect** in pass 2, else Waitlist. Owned space at that pin no longer counts and is reset to "not identified".
- **P5:** a blank or contradictory field is tried at its best and worst value. **Hold** only if it changes the outcome; otherwise continue with an "ask" attached. A held applicant whose best case would win a slot gets "slot held 14 days".
- **P6:** payback fails → Redirect if a pin that passes exists, else **Decline (this site doesn't pay back)**.
- **P7:** allocation. Territories go by priority, then ID. Pass 1 allocates direct applicants. Pass 2 offers leftover free pins to redirect candidates, and each offer reserves its pin. Candidates come only from pins in territories with free slots; pick the highest unserved demand, then the nearest; re-run P6 at the new pin. A 0-slot territory means Waitlist.
- **P8:** count the conditions (buffer, size, 0-year manager and training, no site, launch shorter than the plan, festival conflict, catchment check). 0 conditions = **Approve**, 1–2 = **Approve with conditions**, 3 or more = **Waitlist (not ready yet)**.

**Data and AI:**
- Territory blanks: Priority defaults to Medium, slots to 0, tier comes from the city. Every default is flagged.
- Only regex note flags change decisions. Gemini's reading of a note is shown as a hint and never used in scoring.

**Launch plan:**
- Space ready: 60–75 days. No site: 90–120 days, starting with a site search and brand site audit.
- Days 0–7: KYC, CIBIL check, source of funds, agreement.
- Licences run in parallel (Shops & Establishments, trade licence, GST), marked "typical, verify locally".
- Festivals: Diwali 2026 is about 8 Nov (medium-high confidence), so it is impossible from 25 Oct. Show the earliest realistic date (about early Jan 2027, before Sankranti on 14 Jan and the wedding season). Never push a ready partner back a year.

