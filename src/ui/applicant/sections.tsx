// The sections of the applicant page, in the order an operations manager reads them.
import { MapPin } from 'lucide-react';
import type { Application, Partnership, Result, Territory, TerritoryStatus } from '../../types';
import { CONTRIBUTION_MARGIN, BUFFER_MONTHS, OVERLAP_PLACE_PENALTY, PARTNER_BAR, PAYBACK_TARGET_MONTHS, PLACE_WEIGHTS } from '../../config/rules';
import { Button, DecisionBadge, cx, fmtDate, fmtKm, fmtLakh } from '../components/ui';
import { KV, Section, SourceNote } from './parts';
import { annualRoiPct, combinedArithmetic, lakh2, mainDifference, months, motiveReading, n0, n1, pct, readinessParts, salesFormula } from './model';
import { usePinPotential, type PinPotential } from './usePotential';

// ------------------------------------------------------------------ 2. Who they are / why
export function WhoSection({ r, app }: { r: Result; app: Application | undefined }) {
  const yrs = app?.experienceYears;
  const space = app?.spaceAvailable;
  const spaceTxt = !space ? 'Not given' : space === 'Not yet identified' ? 'No site yet' : `${space}${app?.spaceSizeSqft ? `, ${n0(app.spaceSizeSqft)} sq ft` : ', size not given'}${app?.floor ? `, ${app.floor === 'Mall unit' ? 'mall unit' : `${app.floor.toLowerCase()} floor`}` : ''}`;
  return (
    <Section title="Who they are" subtitle="From the application form">
      <KV
        rows={[
          { k: 'Current or past business', v: <span>{app?.currentBusiness.trim() || 'Not given'}</span> },
          { k: 'Retail experience', v: yrs === null || yrs === undefined ? 'Not given' : `${yrs} year${yrs === 1 ? '' : 's'}` },
          { k: 'Money they can invest', v: app?.investmentLakh === null || app?.investmentLakh === undefined ? 'Not given' : `₹${app.investmentLakh} L` },
          { k: 'Space', v: <span>{spaceTxt}</span> },
          { k: 'Wants to open in', v: app?.targetLaunchMonths ? `${app.targetLaunchMonths} months` : 'Not given (6 assumed)' },
          { k: 'Training language', v: app?.preferredLanguage ?? 'Not given (English assumed)' },
          { k: 'Location', v: `${r.city}${r.pin ? `, ${r.pin}` : ''}` },
        ]}
      />
    </Section>
  );
}

export function WhySection({ app }: { app: Application | undefined }) {
  const notes = app?.notes.trim();
  return (
    <Section title="Why they want a franchise" subtitle="Their own words, then our reading of the form">
      {notes ? (
        <blockquote className="border-l-2 border-brand-600 pl-3 text-sm italic leading-relaxed text-ink">“{notes}”</blockquote>
      ) : (
        <p className="text-sm text-muted">No reason given in the application.</p>
      )}
      {app && (
        <div className="mt-4 rounded-lg bg-canvas px-3 py-2.5">
          <p className="text-xs font-medium text-muted">Reading from the form fields</p>
          <p className="mt-0.5 text-sm text-ink">{motiveReading(app)}</p>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 3. Where
function PotentialBlock({ pt, title }: { pt: PinPotential; title: string }) {
  const existing = pt.verdict === 'Existing store here';
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <div className="mt-2 grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Today, per month</p>
          <KV
            rows={[
              { k: 'Online orders from this pin', v: n0(pt.online_orders_month) },
              { k: 'Store orders from this pin', v: n0(pt.store_orders_month) },
              { k: 'Missed orders', hint: 'Would buy in store if one were in this pin', v: `${n0(pt.missed_orders_month)} (${lakh2(pt.missed_sales_lakh_month)})` },
              {
                k: 'Orders travelling over 4 km',
                hint: pt.redirected_to.length ? pt.redirected_to.map((x) => `${x.store}: ${x.ordersPerMonth}`).join(' · ') : undefined,
                v: n0(pt.redirected_orders_month),
              },
            ]}
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">If a store opens here</p>
          {existing ? (
            <p className="text-sm text-muted">An existing store already serves this pin.</p>
          ) : (
            <>
              <p className="text-sm text-ink">
                Would capture about <span className="tabular font-semibold">{n0(pt.potential_orders_month)}</span> orders a month:{' '}
                <span className="tabular">{n0(pt.incremental_orders_month)}</span> new
                {pt.cannibalised_from.length > 0 && (
                  <>
                    , {pt.cannibalised_from.map((c, i) => (
                      <span key={c.store}>
                        {i > 0 && ', '}
                        <span className="tabular">{n0(c.ordersPerMonth)}</span> from {c.store} {c.area}
                      </span>
                    ))}
                  </>
                )}
                .
              </p>
              <div className="mt-3">
                <KV
                  rows={[
                    { k: 'Capacity used', hint: `of ${n0(pt.capacity_orders_month ?? 600)} orders a standard store handles`, v: `${n0(pt.capacity_use_pct)}%` },
                    { k: 'Sales from order data', v: `${lakh2(pt.est_sales_lakh_month)} / month` },
                    { k: 'Payback from order data', v: months(pt.payback_months) },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PinPotentialFor({ pin, title }: { pin: string | null; title: string }) {
  const pt = usePinPotential(pin);
  if (pt === undefined) return <p className="mt-4 border-t border-line pt-4 text-xs text-muted">Loading order data for {pin}…</p>;
  if (!pt) return null;
  return <PotentialBlock pt={pt} title={title} />;
}

export function WhereSection({ r, terr, status, onMap }: { r: Result; terr: Territory | undefined; status: TerritoryStatus | undefined; onMap: (pin: string) => void }) {
  const p = r.place;
  const filled = status ? status.filled.length : null;
  const demandSrc = p.demandSource === 'orders' ? 'simulated order data, last 12 months' : 'demand proxy v1: city-tier base, +10 near the centre';
  const blr = !!p.pin?.startsWith('560');
  return (
    <Section
      title="Where"
      subtitle={`${p.pin ?? 'Pin unreadable'}${p.pinName && p.pinName !== `Pin ${p.pin}` ? ` · ${p.pinName}` : ''}`}
      action={
        p.pin ? (
          <Button size="sm" onClick={() => onMap(r.redirect?.pin ?? p.pin!)}>
            <MapPin size={14} /> See on map
          </Button>
        ) : undefined
      }
    >
      <KV
        rows={[
          {
            k: 'Territory',
            v: p.territoryId ? `${p.territoryId} · ${p.territoryPriority ?? terr?.priority ?? ''} priority` : 'Not in any territory',
          },
          ...(terr ? [{ k: 'Slots in territory', v: filled !== null && filled >= terr.openSlots ? `${terr.openSlots}, all taken` : `${filled ?? '—'} of ${terr.openSlots} taken` }] : []),
          {
            k: 'Nearest existing store',
            v: p.nearestStore ? `${p.nearestStore.id} ${p.nearestStore.area}, ${fmtKm(p.nearestStore.km)}` : '—',
          },
          {
            k: 'Overlap radius',
            hint: 'Rulebook assumption: a new store inside it competes with the existing one',
            v: `${fmtKm(p.overlapRadiusKm)} · ${p.samePinAsStore ? `same pin as ${p.samePinAsStore}` : p.insideOverlapRadius ? 'inside' : 'outside'}`,
          },
          { k: 'Demand index', hint: demandSrc, v: `${n0(p.demandIndex)} / 100` },
          ...(p.locationApproximate ? [{ k: 'Location', v: 'Approximate (pin not in reference list)' }] : []),
        ]}
      />
      {blr && <PinPotentialFor pin={p.pin} title={`Order data for ${p.pin} (simulated, Bengaluru)`} />}
      {r.redirect && (
        <div className="mt-4 rounded-lg bg-canvas px-3 py-2.5 text-sm">
          <p className="font-medium text-ink">Offered instead: {r.redirect.pin} {r.redirect.pinName}</p>
          <p className="tabular mt-0.5 text-muted">
            {r.redirect.territoryId} · {fmtKm(r.redirect.km)} from their pin · demand {n0(r.redirect.demandIndex)}/100 · payback {months(r.redirect.paybackMonths)}
          </p>
          {r.redirect.pin.startsWith('560') && <PinPotentialFor pin={r.redirect.pin} title={`Order data for ${r.redirect.pin} (simulated)`} />}
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 4. Money
export function MoneySection({ r, app }: { r: Result; app: Application | undefined }) {
  const e = r.economics;
  const have = app?.investmentLakh ?? null;
  const sf = salesFormula(e.tier, e.floorFactor, e.monthlySalesLakh);
  const roi = annualRoiPct(r);
  const contribution = e.monthlySalesLakh * CONTRIBUTION_MARGIN;
  const short = e.capitalGapLakh > 0;
  return (
    <Section title="Money" subtitle={`${e.tier} store · what it costs, what they have, what it earns`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Cash needed vs available</p>
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Total cash needed</span>
                <span className="tabular font-semibold text-ink">{lakh2(e.totalCashNeedLakh)}</span>
              </div>
              <p className="tabular mt-1 text-xs text-muted">
                ₹{e.requiredInvestmentLakh} L investment + {lakh2(e.bufferLakh)} buffer ({BUFFER_MONTHS} months of fixed cost)
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">They can invest</span>
                <span className="tabular font-semibold text-ink">{have === null ? 'Not given' : `₹${have} L`}</span>
              </div>
            </div>
          </div>
          <p className={cx('tabular mt-3 text-sm', short ? 'text-waitlist' : 'text-ink')}>
            {short ? `Short by ${lakh2(e.capitalGapLakh)} (${pct(e.capitalGapPct)} of the need).` : `Fully funded${have !== null ? `, ${lakh2(have - e.totalCashNeedLakh)} to spare` : ''}.`}
            <span className="ml-1 text-muted">Up to 15% short: condition. 15–30%: only with a compact format. Over 30%: decline.</span>
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Store P&amp;L per month</p>
          <KV
            rows={[
              {
                k: 'Sales',
                hint: `₹${sf.base} L tier base × (0.7 + 0.6 × demand ${sf.demand}/100) × ${sf.floor.toLowerCase()} factor ${e.floorFactor}`,
                v: lakh2(e.monthlySalesLakh),
              },
              { k: `Contribution (${pct(CONTRIBUTION_MARGIN)} margin)`, v: lakh2(contribution) },
              { k: 'Fixed cost (rent, staff, utilities)', v: `− ${lakh2(e.monthlyFixedCostLakh)}` },
              { k: 'Monthly profit', v: lakh2(e.monthlyProfitLakh), strong: true },
              {
                k: 'Payback',
                hint: `₹${e.requiredInvestmentLakh} L investment ÷ monthly profit; target ${PAYBACK_TARGET_MONTHS} months or less`,
                v: <span className={cx(!e.paybackPass && 'text-decline')}>{months(e.paybackMonths)} {e.paybackPass ? '(pass)' : '(fails)'}</span>,
                strong: true,
              },
              { k: 'Annual return on investment', hint: 'Monthly profit × 12 ÷ investment', v: roi === null ? '—' : `${n0(roi)}%` },
            ]}
          />
        </div>
      </div>
      <SourceNote>Estimates from rulebook assumptions + simulated order data. They are tested against real store results in the pilot.</SourceNote>
    </Section>
  );
}

// ------------------------------------------------------------------ 5. Score
function ScoreRow({ label, evidence, pts, weight, contrib }: { label: string; evidence: string; pts: number | null; weight: string; contrib: number | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_64px_56px_72px]">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-muted">{evidence}</p>
      </div>
      <p className="tabular text-right text-sm text-ink sm:hidden">
        {pts === null ? '—' : n0(pts)} × {weight} = <span className="font-semibold">{contrib === null ? '—' : n1(contrib)}</span>
      </p>
      <p className="tabular hidden text-right text-sm text-ink sm:block">{pts === null ? '—' : n0(pts)}</p>
      <p className="tabular hidden text-right text-sm text-muted sm:block">{weight}</p>
      <p className="tabular hidden text-right text-sm font-semibold text-ink sm:block">{contrib === null ? '—' : n1(contrib)}</p>
    </div>
  );
}

function ScoreHead() {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_64px_56px_72px] gap-x-4 border-b border-line pb-1.5 text-xs font-medium text-muted sm:grid">
      <span>What we looked at</span>
      <span className="text-right">Points</span>
      <span className="text-right">Weight</span>
      <span className="text-right">Adds</span>
    </div>
  );
}

function Total({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2.5">
      <span className="text-sm font-semibold text-ink">
        {label}
        {note && <span className="ml-2 font-normal text-muted">{note}</span>}
      </span>
      <span className="tabular text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export function ScoreSection({ r, app }: { r: Result; app: Application | undefined }) {
  const band = r.partnerScore >= PARTNER_BAR.strong ? 'strong' : r.partnerScore >= PARTNER_BAR.conditional ? 'conditional' : 'below the bar';
  const p = r.place;
  const rd = readinessParts(r, app);
  const c = combinedArithmetic(r);
  const penalty = p.insideOverlapRadius && !p.samePinAsStore;
  return (
    <Section title="How the score was built" subtitle="Every point traced to a field in the application or a rulebook number">
      <h3 className="text-sm font-medium text-ink">1. Partner score: is this the right person?</h3>
      <div className="mt-2">
        <ScoreHead />
        <div className="divide-y divide-line">
          {r.partnerBreakdown.map((i) => (
            <ScoreRow key={i.label} label={i.label} evidence={i.note} pts={i.score} weight={`${Math.round(i.weight * 100)}%`} contrib={i.score * i.weight} />
          ))}
        </div>
        <Total label="Partner score" value={`${n1(r.partnerScore)} / 100`} note={`${band} (bar: ${PARTNER_BAR.strong} strong, ${PARTNER_BAR.conditional} minimum)`} />
      </div>

      <h3 className="mt-6 text-sm font-medium text-ink">2. Place score: is this the right location?</h3>
      <div className="mt-2">
        <ScoreHead />
        <div className="divide-y divide-line">
          <ScoreRow
            label="Unserved demand"
            evidence={p.nearestStore ? `${fmtKm(p.nearestStore.km)} to ${p.nearestStore.id} vs ${fmtKm(p.overlapRadiusKm)} radius (100 = fully outside)` : 'No store nearby'}
            pts={p.unservedNorm}
            weight={`${Math.round(PLACE_WEIGHTS.unserved * 100)}%`}
            contrib={PLACE_WEIGHTS.unserved * p.unservedNorm}
          />
          <ScoreRow label="Demand" evidence={p.demandSource === 'orders' ? 'Simulated order data' : 'Demand proxy v1'} pts={p.demandIndex} weight={`${Math.round(PLACE_WEIGHTS.demand * 100)}%`} contrib={PLACE_WEIGHTS.demand * p.demandIndex} />
        </div>
        {penalty && <p className="tabular py-1 text-right text-sm text-decline">− {OVERLAP_PLACE_PENALTY} inside another store's overlap radius</p>}
        <Total label="Place score" value={`${n1(p.placeScore)} / 100`} note={p.samePinAsStore ? `0: same pin as ${p.samePinAsStore}` : undefined} />
      </div>

      <h3 className="mt-6 text-sm font-medium text-ink">3. Readiness: can they open on time?</h3>
      <div className="mt-2">
        <div className="divide-y divide-line">
          {rd.rows.map((x) => (
            <ScoreRow key={x.label} label={x.label} evidence={x.evidence} pts={x.pts} weight="—" contrib={x.pts} />
          ))}
        </div>
        <Total label="Readiness" value={`${n0(r.readiness)} / 100`} />
      </div>

      <div className="mt-6 rounded-lg bg-canvas px-3 py-3">
        <p className="text-xs font-medium text-muted">Combined score (used to rank applicants for a slot)</p>
        <p className="tabular mt-1 text-sm text-ink">
          {c.w.partner} × {n1(r.partnerScore)} + {c.w.place} × {n1(p.placeScore)} + {c.w.readiness} × {n0(r.readiness)}
        </p>
        <p className="tabular text-sm text-ink">
          = {n1(c.p)} + {n1(c.pl)} + {n1(c.rd)} = <span className="font-semibold">{r.combinedScore.toFixed(2)}</span>
        </p>
      </div>
      <SourceNote>Weights are rulebook assumptions (src/config/rules.ts), reviewed quarterly against store results.</SourceNote>
    </Section>
  );
}

// ------------------------------------------------------------------ 6. Compare
export function CompareSection({
  r, peers, appByUid, status, terr, onOpen,
}: { r: Result; peers: Result[]; appByUid: Map<string, Application>; status: TerritoryStatus | undefined; terr: Territory | undefined; onOpen: (uid: string) => void }) {
  if (!r.territoryId || peers.length === 0) {
    return (
      <Section title="How they compare">
        <p className="text-sm text-muted">This pin is not in any territory, so there is no slot to compete for.</p>
      </Section>
    );
  }
  const idx = peers.findIndex((p) => p.uid === r.uid);
  const winners = new Set(status?.filled.map((f) => f.uid) ?? []);
  const slots = terr?.openSlots ?? status?.openSlots ?? 0;
  const lo = Math.max(0, idx - 2);
  const hi = Math.min(peers.length, idx + 3);
  const shown = peers.slice(lo, hi);
  const me = appByUid.get(r.uid);
  return (
    <Section
      title={`How they compare in ${r.territoryId}`}
      subtitle={`Position ${idx + 1} of ${peers.length} applicants by combined score${r.rankInTerritory ? ` · slot rank ${r.rankInTerritory} among those who pass every check` : ''} · ${slots} slot${slots === 1 ? '' : 's'}`}
    >
      <p className="text-sm text-ink">
        {winners.has(r.uid)
          ? `Holds one of the ${slots} slots.`
          : slots === 0
            ? 'This territory has no open slots.'
            : `Slots go to the highest combined scores among applicants who pass every check. ${winners.size ? `Lowest slot holder: ${Math.min(...(status?.filled.map((f) => f.combinedScore) ?? [0])).toFixed(2)}.` : ''}`}
      </p>
      <div className="mt-3 overflow-hidden rounded-lg border border-line">
        <div className="hidden grid-cols-[32px_minmax(0,1.4fr)_64px_56px_64px_72px_minmax(0,1.2fr)] gap-x-3 bg-canvas px-3 py-2 text-xs font-medium text-muted md:grid">
          <span>#</span>
          <span>Applicant</span>
          <span className="text-right">Score</span>
          <span className="text-right">Exp.</span>
          <span className="text-right">Capital</span>
          <span className="text-right">Payback</span>
          <span>Difference vs this applicant</span>
        </div>
        <ul className="divide-y divide-line">
          {shown.map((p) => {
            const a = appByUid.get(p.uid);
            const self = p.uid === r.uid;
            const pos = peers.indexOf(p) + 1;
            return (
              <li key={p.uid} className={cx('px-3 py-2.5 text-sm', self && 'bg-brand-50/60')}>
                <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[32px_minmax(0,1.4fr)_64px_56px_64px_72px_minmax(0,1.2fr)] md:items-center">
                  <span className="tabular text-muted">{pos}</span>
                  <div className="min-w-0">
                    {self ? (
                      <span className="font-medium text-ink">{p.appId} {p.name} (this applicant)</span>
                    ) : (
                      <button className="truncate text-left font-medium text-brand-700 hover:underline" onClick={() => onOpen(p.uid)}>
                        {p.appId} {p.name}
                      </button>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <DecisionBadge decision={p.decision} />
                      {winners.has(p.uid) && <span className="text-xs text-muted">Slot holder</span>}
                    </div>
                  </div>
                  <span className="tabular text-right font-semibold text-ink">{p.combinedScore.toFixed(2)}</span>
                  <span className="tabular hidden text-right md:block">{a?.experienceYears ?? '—'} yrs</span>
                  <span className="tabular hidden text-right md:block">{fmtLakh(a?.investmentLakh)}</span>
                  <span className="tabular hidden text-right md:block">{p.economics.paybackMonths === null ? '—' : `${p.economics.paybackMonths.toFixed(1)} mo`}</span>
                  <span className="hidden text-muted md:block">{self ? '—' : mainDifference(r, p, me, a)}</span>
                </div>
                <p className="tabular mt-1 pl-[44px] text-xs text-muted md:hidden">
                  {a?.experienceYears ?? '—'} yrs · {fmtLakh(a?.investmentLakh)} · payback {p.economics.paybackMonths === null ? '—' : `${p.economics.paybackMonths.toFixed(1)} mo`}
                  {!self && <span className="block">{mainDifference(r, p, me, a)}</span>}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      <SourceNote>Showing the two applicants just above and below. Capital is what the applicant can invest; payback is from the rulebook P&amp;L at their pin.</SourceNote>
    </Section>
  );
}

// ------------------------------------------------------------------ 7. Decision and reasons
export function ReasonsSection({ r }: { r: Result }) {
  return (
    <Section title="Decision and reasons" subtitle={<span className="inline-flex items-center gap-2">Rules applied in order; first match decides <DecisionBadge decision={r.decision} /></span>}>
      <ol className="space-y-2">
        {r.reasons.map((x, i) => (
          <li key={i} className="flex gap-3 text-sm text-ink">
            <span className="tabular w-4 shrink-0 text-muted">{i + 1}.</span>
            <span>{x}</span>
          </li>
        ))}
      </ol>
      {r.conditions.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-ink">Conditions to meet</h3>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {r.conditions.map((c) => (
              <li key={c.code} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-sm text-ink">{c.text}</span>
                <span className="tabular shrink-0 text-xs text-muted">
                  {c.owner} · within {c.deadlineDays} days
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.asks.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-ink">Information to request</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {r.asks.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5">
        <h3 className="text-sm font-medium text-ink">What would change this decision</h3>
        {r.whatWouldChange.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {r.whatWouldChange.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing pending: the decision stands unless the application changes.</p>
        )}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 8. Partnership
export function PartnershipSection({ r, pair, onOpen }: { r: Result; pair: Partnership | undefined; onOpen: (uid: string) => void }) {
  const link = r.partnership;
  if (!link) return null;
  const roleTxt = link.role === 'operator' ? 'runs the store (operator)' : 'funds the store (investor)';
  return (
    <Section
      title="Suggested partnership"
      subtitle={link.status === 'allocated' ? 'This pair holds a slot together' : 'Suggested: both applicants must agree'}
      action={<Button size="sm" onClick={() => onOpen(link.withUid)}>Open {link.withAppId}</Button>}
    >
      <p className="text-sm text-ink">
        Pair with <span className="font-medium">{link.withAppId} {link.withName}</span>. This applicant {roleTxt}.
      </p>
      {pair ? (
        <>
          {pair.covers.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">
              {pair.covers.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-x-8 md:grid-cols-2">
            <KV
              rows={[
                { k: 'Joint store at', v: `${pair.pin} ${pair.pinName}` },
                { k: 'Combined capital', v: `${lakh2(pair.combinedInvestmentLakh)} of ${lakh2(pair.totalCashNeedLakh)}` },
                { k: 'Payback', v: months(pair.paybackMonths) },
              ]}
            />
            <KV
              rows={[
                { k: 'Joint partner score', v: `${n1(pair.partnerScore)} / 100` },
                { k: 'Joint combined score', v: pair.combinedScore.toFixed(2) },
                { k: 'Position in territory', v: pair.rankInTerritory ?? '—' },
              ]}
            />
          </div>
          {pair.outcome && <p className="mt-3 text-sm text-muted">{pair.outcome}</p>}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Partnership details are not available in this run.</p>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 9. Next steps and preparation
export function PlanSection({ r }: { r: Result }) {
  const plan = r.launchPlan;
  return (
    <Section
      title="Next steps and preparation"
      subtitle={plan ? `${plan.totalDays}-day plan · opens ${fmtDate(plan.targetOpenDate)} · training in ${plan.trainingLanguage}` : 'A full launch plan is drafted once the application is approved'}
    >
      {r.nextSteps.length > 0 && (
        <ol className="space-y-2">
          {r.nextSteps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-ink">
              <span className="tabular w-4 shrink-0 text-muted">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
      {plan && (
        <>
          {plan.festivalNote && <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-sm text-ink">{plan.festivalNote}</p>}
          <h3 className="mt-5 text-sm font-medium text-ink">Launch plan</h3>
          <ul className="mt-2 divide-y divide-line">
            {plan.steps.map((s, i) => {
              const total = Math.max(1, plan.totalDays);
              return (
                <li key={i} className="grid gap-1 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)] md:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{s.task}</p>
                    <p className="tabular text-xs text-muted">
                      {s.phase} · {s.owner} · due {fmtDate(s.dueDate)}
                    </p>
                  </div>
                  <div className="self-center">
                    <div className="relative h-2 rounded-full bg-slate-100">
                      <span
                        className="absolute inset-y-0 rounded-full bg-brand-600"
                        style={{ left: `${(Math.max(0, s.dayFrom) / total) * 100}%`, width: `${Math.max(2, ((Math.min(total, s.dayTo) - Math.max(0, s.dayFrom)) / total) * 100)}%` }}
                      />
                    </div>
                    <p className="tabular mt-0.5 text-right text-[11px] text-muted">
                      Day {s.dayFrom}–{s.dayTo}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <h3 className="mt-5 text-sm font-medium text-ink">How we prepare them</h3>
          <p className="mt-1 text-sm text-ink">
            Weakest readiness stage (ADKAR): <span className="font-medium">{plan.weakestStage}</span>
            {plan.adkar[0]?.note && <span className="text-muted">: {plan.adkar[0].note}</span>}
          </p>
          {plan.shadowStore && (
            <p className="mt-1 text-sm text-ink">
              Shadow store: {plan.shadowStore.id} {plan.shadowStore.area} ({fmtKm(plan.shadowStore.km)} away)
            </p>
          )}
          {plan.training.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              {plan.training.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {!plan && r.preparation.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-medium text-ink">How we prepare them</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {r.preparation.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
