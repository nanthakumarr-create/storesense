// D3 Territory fill status: who got each slot, who competed for it, and why.
import { useMemo, useState } from 'react';
import { ArrowUpCircle, LayoutGrid, Search, Trophy, Users } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Priority, TerritoryStatus } from '../../types';
import { Card, DECISION_STYLE, DecisionBadge, EmptyState, PageHeader, Pill, Stat, cx } from '../components/ui';
import { PRIORITY_ORDER } from '../../config/rules';

const PRIORITY_TONE: Record<Priority, 'bad' | 'warn' | 'neutral'> = { High: 'bad', Medium: 'warn', Low: 'neutral' };

function SlotMeter({ t }: { t: TerritoryStatus }) {
  const filled = t.filled.slice(0, Math.max(t.openSlots, 0));
  const open = Math.max(0, t.openSlots - filled.length);
  if (t.openSlots === 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">No open slots in this territory. Applicants here are waitlisted.</p>;
  }
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink">Slots</span>
        <span className="tabular text-muted"><span className="font-semibold text-ink">{filled.length}</span> of {t.openSlots} filled</span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {filled.map((f) => (
          <span key={f.uid} title={`${f.appId} · ${f.decision}`} className="h-2.5 flex-1 rounded-sm" style={{ background: DECISION_STYLE[f.decision].hex }} />
        ))}
        {Array.from({ length: open }).map((_, i) => (
          <span key={`o${i}`} title="Open slot" className="h-2.5 flex-1 rounded-sm border border-dashed border-slate-300 bg-slate-50" />
        ))}
      </div>
    </div>
  );
}

function TerritoryCard({ t, onOpen }: { t: TerritoryStatus; onOpen: (uid: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const contenders = showAll ? t.contenders : t.contenders.slice(0, 4);
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="tabular text-sm font-semibold text-ink">{t.id}</h3>
            <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority} priority</Pill>
          </div>
          <p className="mt-0.5 text-xs text-muted">{t.city} · {t.tier}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-lg font-semibold leading-none text-ink">{t.filled.length}/{t.openSlots}</p>
          <p className="mt-0.5 text-[11px] text-muted">{t.contenders.length} other contender{t.contenders.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3">
        <SlotMeter t={t} />

        {t.suggestRaisePriority && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-waitlist">
            <ArrowUpCircle size={15} className="mt-px shrink-0" />
            <span><span className="font-semibold">Consider raising priority.</span> Demand here is strong and good applicants are waiting for a slot.</span>
          </div>
        )}

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><Trophy size={12} />Slot winners</p>
          {t.filled.length ? (
            <ul className="space-y-1">
              {t.filled.map((f) => (
                <li key={f.uid}>
                  <button onClick={() => onOpen(f.uid)} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-left hover:bg-slate-100">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink"><span className="tabular font-semibold">{f.appId}</span> · {f.name}</p>
                      <p className="tabular text-[11px] text-muted">Pin {f.pin} · combined {f.combinedScore.toFixed(1)}</p>
                    </div>
                    <DecisionBadge decision={f.decision} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No one filled a slot here yet.</p>
          )}
        </div>

        {t.contenders.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><Users size={12} />Other contenders</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {contenders.map((c) => (
                <li key={c.uid}>
                  <button onClick={() => onOpen(c.uid)} className="w-full px-2.5 py-2 text-left hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink"><span className="tabular font-semibold">{c.appId}</span> · {c.name}</p>
                      <DecisionBadge decision={c.decision} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted"><span className="tabular">Combined {c.combinedScore.toFixed(1)}</span>{c.note ? ` · ${c.note}` : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
            {t.contenders.length > 4 && (
              <button onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-xs font-medium text-brand-700 hover:underline">
                {showAll ? 'Show fewer' : `Show all ${t.contenders.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {t.reason && <p className="mt-auto border-t border-line bg-slate-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-700"><span className="font-medium text-ink">Why: </span>{t.reason}</p>}
    </Card>
  );
}

export function TerritoriesPage() {
  const { output, openApplicant } = useApp();
  const [city, setCity] = useState('All');
  const [priority, setPriority] = useState<Priority | 'All'>('All');
  const [q, setQ] = useState('');

  const all = output?.territories ?? [];
  const cities = useMemo(() => ['All', ...[...new Set(all.map((t) => t.city))].sort()], [all]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((t) => (city === 'All' || t.city === city) && (priority === 'All' || t.priority === priority))
      .filter((t) => !s || t.id.toLowerCase().includes(s) || [...t.filled, ...t.contenders].some((p) => p.appId.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)))
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [all, city, priority, q]);

  const totals = useMemo(() => {
    const slots = all.reduce((n, t) => n + t.openSlots, 0);
    const filled = all.reduce((n, t) => n + Math.min(t.filled.length, t.openSlots), 0);
    return { slots, filled, raise: all.filter((t) => t.suggestRaisePriority).length, contenders: all.reduce((n, t) => n + t.contenders.length, 0) };
  }, [all]);

  return (
    <div className="space-y-5">
      <PageHeader title="Territory fill status" subtitle="Who got each open slot, who else competed, and why. High priority territories are filled first." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Territories" value={all.length} hint={`${cities.length - 1} cities`} />
        <Stat label="Slots filled" value={`${totals.filled} / ${totals.slots}`} hint={`${totals.slots - totals.filled} still open`} />
        <Stat label="Other contenders" value={totals.contenders} hint="Waitlisted, redirected or not ready" />
        <Stat label="Raise priority?" value={totals.raise} hint="Territories flagged by demand" tone={totals.raise ? 'warn' : undefined} />
      </div>

      <Card className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search territory, APP-ID or name"
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand-500">
          {cities.map((c) => (
            <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-line bg-slate-50 p-0.5 text-xs font-medium">
          {(['All', ...PRIORITY_ORDER] as const).map((p) => (
            <button key={p} onClick={() => setPriority(p)} className={cx('flex-1 rounded-md px-3 py-1.5', priority === p ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              {p}
            </button>
          ))}
        </div>
      </Card>

      {all.length === 0 ? (
        <Card><EmptyState icon={<LayoutGrid size={36} />} title="No territories yet" body="Territories appear once the Territories sheet is read and the rules have run." /></Card>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={<Search size={32} />} title="No territory matches these filters" body="Clear the search or pick another city or priority." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((t) => (
            <TerritoryCard key={t.id} t={t} onOpen={openApplicant} />
          ))}
        </div>
      )}
    </div>
  );
}
