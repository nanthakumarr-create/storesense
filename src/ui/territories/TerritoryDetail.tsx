// One territory: its facts, every applicant compared side by side, suggested partnerships and why the slots went this way.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Result } from '../../types';
import { Button, Card, EmptyState } from '../components/ui';
import { ComparisonTable, type Row } from './ComparisonTable';
import { PartnershipCards } from './PartnershipCards';
import { areaNames, avgDemand, fmtNum, nearestStores, pinName, slotUnits, territoryTitle, unitLabel } from './helpers';

interface PotentialPin {
  pin: string;
  missed_orders_month: number;
  missed_sales_lakh_month: number;
  online_orders_month: number;
  store_orders_month: number;
}

// Bengaluru order data is large; load it only when a territory page opens.
let potentialCache: Record<string, PotentialPin> | null = null;
function usePotential(): Record<string, PotentialPin> | null {
  const [data, setData] = useState(potentialCache);
  useEffect(() => {
    if (potentialCache) return;
    let live = true;
    import('../../data/blr-potential.json')
      .then((m) => {
        const pins = (m.default as unknown as { pins: PotentialPin[] }).pins;
        potentialCache = Object.fromEntries(pins.map((p) => [p.pin, p]));
        if (live) setData(potentialCache);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return data;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function TerritoryDetail({ id }: { id: string }) {
  const { output, parse, ctx, openTerritory, openApplicant, openMapAt } = useApp();
  const potential = usePotential();
  const t = output?.territories.find((x) => x.id === id);
  const terr = parse?.territories.find((x) => x.id === id);
  const pins = useMemo(() => terr?.pins ?? [], [terr]);

  const rows: Row[] = useMemo(() => {
    if (!output || !t) return [];
    const apps = new Map((parse?.applications ?? []).map((a) => [a.uid, a]));
    const applied = output.results.filter((r) => r.territoryId === t.id);
    const filledOrder = t.filled.map((f) => f.uid);
    // An allocated pair shares one slot: the partner counts as a winner and is listed right after their pair-mate.
    const pairMate = (r: Result) => (r.partnership?.status === 'allocated' ? r.partnership.withUid : null);
    const won = (r: Result) => filledOrder.includes(r.uid) || (pairMate(r) !== null && filledOrder.includes(pairMate(r)!));
    const winners: Result[] = [];
    for (const r of applied.filter((x) => filledOrder.includes(x.uid)).sort((a, b) => filledOrder.indexOf(a.uid) - filledOrder.indexOf(b.uid))) {
      winners.push(r);
      const mate = applied.find((x) => x.uid === pairMate(r));
      if (mate && !winners.includes(mate)) winners.push(mate);
    }
    for (const r of applied) if (won(r) && !winners.includes(r)) winners.push(r);
    const ordered = [
      ...winners,
      ...applied.filter((r) => !won(r)).sort((a, b) => b.combinedScore - a.combinedScore || a.appId.localeCompare(b.appId, undefined, { numeric: true })),
    ];
    return ordered.map((r, i) => ({ r, app: apps.get(r.uid), rank: i + 1, won: won(r) }));
  }, [output, parse, t]);

  if (!output || !t) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => openTerritory(null)} />
        <Card>
          <EmptyState title={`Territory ${id} is not in this file`} body="It may have been renamed or removed in the latest upload." action={<Button onClick={() => openTerritory(null)}>See all territories</Button>} />
        </Card>
      </div>
    );
  }

  const units = slotUnits(t, new Map(output.results.map((r) => [r.uid, r])));
  const areas = areaNames(pins, t.city, 3);
  const stores = nearestStores(pins, parse?.stores ?? [], 2);
  const demand = avgDemand(pins, ctx);
  const pot = potential ? pins.map((p) => potential[p]).filter(Boolean) : [];
  const missed = pot.reduce((s, p) => s + p.missed_orders_month, 0);
  const missedSales = pot.reduce((s, p) => s + p.missed_sales_lakh_month, 0);
  const online = pot.reduce((s, p) => s + p.online_orders_month, 0);
  const pairs = (output.partnerships ?? []).filter((p) => p.territoryId === t.id);
  const redirectedIn = t.filled.filter((f) => !rows.some((row) => row.r.uid === f.uid));

  // Budget mix: who can fund alone, who has money but no experience, who has experience but not the money.
  const mix = rows.reduce(
    (m, { r, app }) => {
      const exp = app?.experienceYears ?? 0;
      const funded = r.economics.capitalGapLakh <= 0 && app?.investmentLakh != null;
      if (funded && exp > 0) m.ready++;
      else if (funded && exp === 0) m.moneyOnly++;
      else if (!funded && exp > 0) m.expOnly++;
      return m;
    },
    { ready: 0, moneyOnly: 0, expOnly: 0 },
  );

  return (
    <div className="space-y-8">
      <div>
        <BackLink onClick={() => openTerritory(null)} />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{territoryTitle(t, pins)}</h1>
            <p className="mt-1 text-sm text-muted">
              {rows.length} applicant{rows.length === 1 ? '' : 's'} for {t.openSlots} open slot{t.openSlots === 1 ? '' : 's'}.{' '}
              {units.length ? `Slots went to ${units.map(unitLabel).join(', ')}.` : 'No slot filled yet.'}
            </p>
          </div>
          {pins[0] && (
            <Button onClick={() => openMapAt(t.filled[0]?.pin || pins[0])}>See this area on the map</Button>
          )}
        </div>
      </div>

      <Card className="px-4 py-1">
        <dl className="divide-y divide-line">
          <Fact label="Priority and slots">
            {t.priority} priority · {t.tier} · <span className="tabular">{units.length} of {t.openSlots}</span> open slots filled{units.some((u) => u.names.length > 1) ? ' (a pair shares one slot)' : ''}
          </Fact>
          <Fact label="Pin codes covered">
            <span className="tabular">{pins.length}</span> pins{areas.length ? `, including ${areas.join(', ')}` : ''}
            <span className="tabular mt-1 block text-xs text-muted">{pins.map((p) => `${p} ${pinName(p) !== p ? pinName(p) : ''}`.trim()).join(' · ')}</span>
          </Fact>
          <Fact label="Nearest existing stores">
            {stores.length
              ? stores.map((s, i) => (
                  <span key={s.id} className="tabular">
                    {i > 0 && ' · '}
                    {s.id} {s.area} {s.inside ? '(inside this territory)' : `(${fmtNum(s.km, 1)} km from the nearest pin)`}
                  </span>
                ))
              : 'No existing store in this city: open market'}
          </Fact>
          <Fact label="Demand">
            {pot.length ? (
              <>
                <span className="tabular">{fmtNum(missed)}</span> store orders a month are missed in these pins (worth ₹<span className="tabular">{fmtNum(missedSales, 1)}</span>L a month), and customers here place{' '}
                <span className="tabular">{fmtNum(online)}</span> online orders a month.
                <span className="mt-1 block text-xs text-muted">Source: simulated Bengaluru order data, last 12 months, scaled to store level.</span>
              </>
            ) : demand ? (
              <>
                Average demand index <span className="tabular">{fmtNum(demand.value)}</span> / 100.
                <span className="mt-1 block text-xs text-muted">Source: simulated order data.</span>
              </>
            ) : t.city === 'Bengaluru' && !potential ? (
              'Loading order data…'
            ) : (
              <>
                No order data for {t.city} yet; demand is estimated from city tier and distance to the centre.
                <span className="mt-1 block text-xs text-muted">Source: rulebook assumption.</span>
              </>
            )}
          </Fact>
        </dl>
      </Card>

      <Section
        title="Compare the applicants"
        subtitle={
          rows.length ? (
            <>
              Ranked by combined score: the top {t.openSlots} who pass every check win the slots. Click an applicant for the full reasoning. Budgets:{' '}
              <span className="tabular">{mix.ready}</span> can fund the store alone and have experience, <span className="tabular">{mix.moneyOnly}</span> have the money but no experience,{' '}
              <span className="tabular">{mix.expOnly}</span> have experience but not enough money.
            </>
          ) : undefined
        }
      >
        <Card className="overflow-hidden">
          {rows.length ? (
            <ComparisonTable rows={rows} slots={t.openSlots} slotsUsed={units.length} onOpen={(uid) => openApplicant(uid)} />
          ) : (
            <EmptyState title="No one applied here yet" body="Target local retailers in these pin codes, especially optical and footwear shops." />
          )}
        </Card>
        {redirectedIn.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            Also holding a slot here after a redirect from another area:{' '}
            {redirectedIn.map((f, i) => (
              <span key={f.uid}>
                {i > 0 && ', '}
                <button onClick={() => openApplicant(f.uid)} className="text-brand-700 hover:underline">
                  {f.name} ({f.appId})
                </button>{' '}
                at pin {f.pin}
              </span>
            ))}
            .
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Need = store investment for {t.tier} plus a 3-month cash buffer (rulebook assumption). Sales, payback and ROI are estimates from the rulebook model on simulated demand at each applicant's pin.
        </p>
      </Section>

      <Section
        title="Suggested partnerships"
        subtitle="Pairs an applicant with money but no experience with an experienced applicant who is short of money, so the store has both the funding and someone who can run it."
      >
        <PartnershipCards pairs={pairs} onOpen={(uid) => openApplicant(uid)} />
      </Section>

      <Section title="Why the slots went this way">
        <Card className="px-4 py-3 text-sm leading-relaxed text-slate-700">{t.reason || 'No explanation was produced for this territory.'}</Card>
      </Section>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <button onClick={onClick} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
        <ChevronLeft size={14} /> Applications by territory
      </button>
    </nav>
  );
}
