// Applications grouped by the territory each applicant applied to (the pin they gave decides the territory).
import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Result } from '../../types';
import { Card, DecisionBadge, EmptyState, PageHeader, cx } from '../components/ui';
import { FILTERS, areaNames, compassLabel, matchesFilter, slotUnits, sortTerritories, unitLabel, type DecisionFilter } from './helpers';

// Remembered while the app is open, so going back from a territory keeps the filter.
let lastFilter: DecisionFilter = 'all';

function SlotMeter({ filled, open }: { filled: number; open: number }) {
  if (open === 0) return <span className="text-xs text-muted">No open slots</span>;
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
              <p className="truncate text-xs text-muted">{r.headline}</p>
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
  const { output, parse, openTerritory, openApplicant } = useApp();
  const [filter, setFilterState] = useState<DecisionFilter>(lastFilter);
  const [q, setQ] = useState('');
  const setFilter = (f: DecisionFilter) => {
    lastFilter = f;
    setFilterState(f);
  };

  const results = useMemo(() => output?.results ?? [], [output]);
  const partnerships = useMemo(() => output?.partnerships ?? [], [output]);
  const byUid = useMemo(() => new Map(results.map((r) => [r.uid, r])), [results]);
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
        const pairs = partnerships.filter((p) => p.territoryId === t.id).length;
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
        <div className="flex overflow-x-auto rounded-lg border border-line bg-white p-0.5 text-xs font-medium" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              title={f.id === 'action' ? 'On hold, approved with conditions, or redirected: someone has to follow up' : undefined}
              className={cx('whitespace-nowrap rounded-md px-3 py-1.5', filter === f.id ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-ink')}
            >
              {f.label} <span className="tabular">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <PersonSearch q={q} matches={people} onOpen={(uid) => openApplicant(uid)} />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No territory matches" body="Clear the search or choose another filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_80px_140px_90px_minmax(0,1.6fr)_24px] gap-4 border-b border-line bg-slate-50 px-4 py-2 text-xs font-medium text-muted md:grid">
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
                    <p className="truncate text-xs text-muted">
                      {areas.length ? areas.join(', ') : 'Area names not available'} · {t.tier}
                      {pairs > 0 && ` · ${pairs} suggested partnership${pairs === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <ChevronRight size={16} className="self-center text-muted md:hidden" />
                  <div className="col-span-2 space-y-0.5 text-xs text-muted md:hidden">
                    <p className="tabular">
                      {t.priority} priority · {t.openSlots ? `${Math.min(units.length, t.openSlots)} of ${t.openSlots} slots filled` : 'no open slots'} ·{' '}
                      {filter === 'all' ? applied.length : `${shown.length} of ${applied.length}`} applicants
                    </p>
                    <p className="truncate text-ink">{units.length ? `Won by ${units.map(unitLabel).join(', ')}` : 'No winner yet'}</p>
                  </div>
                  <span className="hidden text-sm text-ink md:block">{t.priority}</span>
                  <div className="hidden md:block"><SlotMeter filled={units.length} open={t.openSlots} /></div>
                  <span className="tabular hidden text-right text-sm text-ink md:block">
                    {filter === 'all' ? applied.length : `${shown.length} of ${applied.length}`}
                  </span>
                  <span className="hidden min-w-0 truncate text-sm text-ink md:block">
                    {units.length ? units.map(unitLabel).join(', ') : <span className="text-muted">No winner yet</span>}
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
        note="Their pin code is not in the Territories sheet, so they cannot take a slot there. Open one to see where they were sent and why."
        people={outside}
        onOpen={(uid) => openApplicant(uid)}
      />
      <PeopleGroup title="Data problems" note="The pin code could not be read. Ask the applicant to confirm it." people={problems} onOpen={(uid) => openApplicant(uid)} />
    </div>
  );
}
