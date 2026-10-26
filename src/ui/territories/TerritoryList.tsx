// Applications grouped by the territory each applicant applied to (the pin they gave decides the territory).
import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Application, Partnership, Result } from '../../types';
import { Card, DecisionBadge, EmptyState, PageHeader, cx, fmtLakh } from '../components/ui';
import { FILTERS, areaNames, compassLabel, matchesFilter, slotUnits, sortTerritories, unitLabel, type DecisionFilter } from './helpers';

// Remembered while the app is open, so going back from a territory keeps the filter.
let lastFilter: DecisionFilter = 'all';
/** Preselect a filter before opening the list (used by the Overview buttons). */
export const presetApplicationsFilter = (f: DecisionFilter) => {
  lastFilter = f;
};

function SlotMeter({ filled, open }: { filled: number; open: number }) {
  if (open === 0) return <span className="text-xs text-muted" title="The brand has no open slots here this round">0 slots planned</span>;
  const used = Math.min(filled, open);
  return (
    <div className="w-full max-w-[120px]">
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: open }).map((_, i) => (
          <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < used ? 'bg-brand-600' : 'bg-slate-200')} />
        ))}
      </div>
      <p className="tabular mt-1 text-xs text-muted">
        <span className="font-medium text-ink">{used}</span> of {open} filled
      </p>
    </div>
  );
}

const expLabel = (y: number | null | undefined) => (y === null || y === undefined ? 'experience not given' : y === 0 ? 'no retail experience' : `${y} yr${y === 1 ? '' : 's'} retail`);

/** "2 partnerships" label that shows each pair on hover or focus, and says whether the pair holds a slot or is a backup. */
function PartnershipHover({ pairs, appByUid }: { pairs: Partnership[]; appByUid: Map<string, Application> }) {
  const won = pairs.filter((p) => p.status === 'allocated').length;
  const label = `${pairs.length} partnership${pairs.length === 1 ? '' : 's'}${won ? ` (${won} won a slot)` : ' suggested'}`;
  return (
    <span className="group/pairs relative inline-block" tabIndex={0} onClick={(e) => e.stopPropagation()}>
      <span className="cursor-help border-b border-dotted border-muted">{label}</span>
      <span
        role="tooltip"
        className="invisible absolute left-0 top-full z-[600] mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-white p-3 text-left opacity-0 shadow-lg transition-opacity group-hover/pairs:visible group-hover/pairs:opacity-100 group-focus/pairs:visible group-focus/pairs:opacity-100"
      >
        <span className="mb-2 block text-xs text-muted">An experienced operator short of money, paired with an investor in the same territory.</span>
        {pairs.map((p) => (
          <span key={p.id} className="block border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink">
                {p.operatorName} + {p.investorName}
              </span>
              <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', p.status === 'allocated' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>
                {p.status === 'allocated' ? 'Slot winner' : 'Backup, not in a slot'}
              </span>
            </span>
            <span className="tabular mt-0.5 block text-xs text-muted">
              Operator {p.operatorAppId}: {expLabel(appByUid.get(p.operatorUid)?.experienceYears)} · Investor {p.investorAppId}:{' '}
              {expLabel(appByUid.get(p.investorUid)?.experienceYears)}
            </span>
            <span className="tabular block text-xs text-muted">
              {fmtLakh(p.combinedInvestmentLakh)} together vs {fmtLakh(p.totalCashNeedLakh)} needed
              {p.rankInTerritory ? ` · would rank #${p.rankInTerritory}` : ''}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

function PersonSearch({ q, matches, onOpen }: { q: string; matches: Result[]; onOpen: (uid: string) => void }) {
  if (!q.trim()) return null;
  if (!matches.length) return null;
  return (
    <Card className="divide-y divide-line">
      <p className="px-4 py-2 text-xs text-muted">
        {matches.length} applicant{matches.length === 1 ? '' : 's'} match “{q.trim()}”
      </p>
      {matches.slice(0, 6).map((r) => (
        <button key={r.uid} onClick={() => onOpen(r.uid)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">
              <span className="tabular font-medium">{r.appId}</span> · {r.name}
            </p>
            <p className="tabular truncate text-xs text-muted">
              {r.city} · pin {r.pin ?? 'unreadable'} · {r.territoryId ?? 'outside any territory'}
            </p>
          </div>
          <DecisionBadge decision={r.decision} />
          <span className="hidden text-xs font-medium text-brand-700 sm:inline">Open</span>
        </button>
      ))}
    </Card>
  );
}

function PeopleGroup({ title, note, people, onOpen }: { title: string; note: string; people: Result[]; onOpen: (uid: string) => void }) {
  const [all, setAll] = useState(false);
  if (!people.length) return null;
  const shown = all ? people : people.slice(0, 5);
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">
        {title} <span className="tabular font-normal text-muted">({people.length})</span>
      </h2>
      <p className="mb-2 mt-0.5 text-xs text-muted">{note}</p>
      <Card className="divide-y divide-line">
        {shown.map((r) => (
          <button key={r.uid} onClick={() => onOpen(r.uid)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                <span className="tabular font-medium">{r.appId}</span> · {r.name}
              </p>
              <p className="truncate text-xs text-muted" title={r.headline}>{r.headline}</p>
            </div>
            <DecisionBadge decision={r.decision} />
          </button>
        ))}
        {people.length > 5 && (
          <button onClick={() => setAll((v) => !v)} className="w-full px-4 py-2.5 text-left text-sm font-medium text-brand-700 hover:bg-slate-50">
            {all ? 'Show fewer' : `Show all ${people.length}`}
          </button>
        )}
      </Card>
    </section>
  );
}

export function TerritoryList() {
  const { output, parse, openTerritory, peekApplicant } = useApp();
  const [filter, setFilterState] = useState<DecisionFilter>(lastFilter);
  const [q, setQ] = useState('');
  const setFilter = (f: DecisionFilter) => {
    lastFilter = f;
    setFilterState(f);
  };

  const results = useMemo(() => output?.results ?? [], [output]);
  const partnerships = useMemo(() => output?.partnerships ?? [], [output]);
  const byUid = useMemo(() => new Map(results.map((r) => [r.uid, r])), [results]);
  const appByUid = useMemo(() => new Map((parse?.applications ?? []).map((a) => [a.uid, a])), [parse]);
  const pinsById = useMemo(() => new Map((parse?.territories ?? []).map((t) => [t.id, t.pins])), [parse]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sortTerritories(output?.territories ?? [])
      .map((t) => {
        const pins = pinsById.get(t.id) ?? [];
        const applied = results.filter((r) => r.territoryId === t.id);
        const shown = applied.filter((r) => matchesFilter(r, filter));
        const areas = areaNames(pins, t.city);
        const dir = compassLabel(pins, t.city);
        const pairs = partnerships.filter((p) => p.territoryId === t.id);
        const units = slotUnits(t, byUid);
        return { t, pins, applied, shown, areas, dir, pairs, units };
      })
      .filter((row) => filter === 'all' || row.shown.length > 0)
      .filter(
        (row) =>
          !s ||
          row.t.id.toLowerCase().includes(s) ||
          row.t.city.toLowerCase().includes(s) ||
          row.areas.some((a) => a.toLowerCase().includes(s)) ||
          row.pins.some((p) => p.includes(s)) ||
          row.applied.some((r) => r.appId.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)),
      );
  }, [output, results, partnerships, pinsById, byUid, filter, q]);

  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return results.filter((r) => r.appId.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.pin ?? '').includes(s));
  }, [results, q]);

  const outside = results.filter((r) => r.territoryId === null && r.pin !== null && matchesFilter(r, filter));
  const problems = results.filter((r) => r.pin === null && matchesFilter(r, filter));
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, results.filter((r) => matchesFilter(r, f.id)).length])) as Record<DecisionFilter, number>, [results]);
  const slots = (output?.territories ?? []).reduce((n, t) => n + t.openSlots, 0);

  if (!output || !results.length) {
    return (
      <div>
        <PageHeader title="Applications by territory" />
        <Card>
          <EmptyState title="No applications loaded" body="Upload the Applications and Territories sheets from Data & CRM to see who applied where." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications by territory"
        subtitle={`${results.length} applications across ${output.territories.length} territories, ${slots} open slots. Each applicant is placed in the territory that covers their pin code. Open a territory to compare its applicants.`}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an applicant (name, APP-ID or pin) or a territory"
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="flex gap-4 overflow-x-auto text-sm" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              title={
                f.id === 'action'
                  ? 'On hold or redirected: someone has to follow up. Conditional approvals are counted under Approved only.'
                  : f.id === 'approved'
                    ? `${results.filter((r) => r.decision === 'Approve').length} outright + ${results.filter((r) => r.decision === 'Approve with conditions').length} with conditions`
                    : f.id === 'all'
                      ? 'The other four filters do not overlap and add up to this number'
                      : undefined
              }
              className={cx('whitespace-nowrap border-b-2 pb-1.5 pt-1', filter === f.id ? 'border-brand-600 font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
            >
              {f.label} <span className="tabular">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <PersonSearch q={q} matches={people} onOpen={(uid) => peekApplicant(uid)} />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No territory matches" body="Clear the search or choose another filter." />
        </Card>
      ) : (
        <Card>
          <div className="hidden grid-cols-[minmax(0,2.2fr)_80px_140px_90px_minmax(0,1.6fr)_24px] gap-4 rounded-t-xl border-b border-line bg-slate-50 px-4 py-2 text-xs font-medium text-muted md:grid">
            <span>Territory</span>
            <span>Priority</span>
            <span>Slots</span>
            <span className="text-right">Applicants</span>
            <span>Slot winners</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {rows.map(({ t, shown, applied, areas, dir, pairs, units }) => (
              <li key={t.id}>
                <button onClick={() => openTerritory(t.id)} className="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,2.2fr)_80px_140px_90px_minmax(0,1.6fr)_24px] md:items-center">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <span className="tabular font-semibold">{t.id}</span> · {t.city}
                      {dir ? ` ${dir}` : ''}
                    </p>
                    <p className="text-xs text-muted">
                      {areas.length ? areas.join(', ') : 'Area names not available'} · {t.tier}
                      {pairs.length > 0 && (
                        <>
                          {' · '}
                          <PartnershipHover pairs={pairs} appByUid={appByUid} />
                        </>
                      )}
                    </p>
                  </div>
                  <ChevronRight size={16} className="self-center text-muted md:hidden" />
                  <div className="col-span-2 space-y-0.5 text-xs text-muted md:hidden">
                    <p className="tabular">
                      {t.priority} priority · {t.openSlots ? `${Math.min(units.length, t.openSlots)} of ${t.openSlots} slots filled` : 'no open slots'} ·{' '}
                      {filter === 'all' ? applied.length : `${shown.length} of ${applied.length}`} applicants
                    </p>
                    <p className="text-ink">{units.length ? `Won by ${units.map(unitLabel).join(', ')}` : t.openSlots === 0 ? 'Full, no winner needed' : 'No winner yet'}</p>
                  </div>
                  <span className="hidden text-sm text-ink md:block">{t.priority}</span>
                  <div className="hidden md:block"><SlotMeter filled={units.length} open={t.openSlots} /></div>
                  <span className="tabular hidden text-right text-sm text-ink md:block">
                    {filter === 'all' ? applied.length : `${shown.length} of ${applied.length}`}
                  </span>
                  <span className="hidden min-w-0 text-sm leading-snug text-ink md:block" title={units.length ? units.map(unitLabel).join(', ') : undefined}>
                    {units.length ? (
                      units.map(unitLabel).join(', ')
                    ) : t.openSlots === 0 ? (
                      <span className="text-muted">Full, no winner needed</span>
                    ) : (
                      <span className="text-muted">No winner yet</span>
                    )}
                  </span>
                  <ChevronRight size={16} className="hidden text-muted md:block" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PeopleGroup
        title="Outside any territory"
        note="Their pin code is not in the target territories, so they cannot take a slot. The rule is the same for everyone: if they pass the partner and capital checks they are waitlisted (no territory yet) and the pin is listed as a possible new territory; if they fail those checks they are declined first."
        people={outside}
        onOpen={(uid) => peekApplicant(uid)}
      />
      <PeopleGroup title="Data problems" note="The pin code could not be read. Ask the applicant to confirm it." people={problems} onOpen={(uid) => peekApplicant(uid)} />
    </div>
  );
}
