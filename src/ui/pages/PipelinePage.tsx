// D1 · Applications: every applicant with its decision, reasons, scores and next step.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Download, FileSpreadsheet, Filter, Search, X } from 'lucide-react';
import { useApp } from '../../state/AppState';
import { DECISIONS, type Decision, type Result } from '../../types';
import { Button, Card, DECISION_STYLE, DecisionBadge, EmptyState, PageHeader, ScoreBar, cx, fmtInt } from '../components/ui';
import { DEFAULT_DESC, buildDecisionCsv, compareResults, downloadText, fmtMonths, fmtScore, issueCount, type SortKey } from '../pipeline/helpers';
import { PAYBACK_TARGET_MONTHS } from '../../config/rules';

const DECISION_HINT: Record<Decision, string> = {
  Approve: 'Right place, right partner',
  'Approve with conditions': 'Good fit, named gaps',
  Redirect: 'Offered a better pin',
  Waitlist: 'Viable, no slot now',
  Hold: 'Info missing or unclear',
  Decline: 'Below the bar',
};

function DecisionTiles({ counts, active, onPick }: { counts: Record<Decision, number>; active: Decision | ''; onPick: (d: Decision | '') => void }) {
  const total = DECISIONS.reduce((s, d) => s + (counts[d] ?? 0), 0);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {DECISIONS.map((d) => {
        const s = DECISION_STYLE[d];
        const n = counts[d] ?? 0;
        const on = active === d;
        return (
          <button
            key={d}
            onClick={() => onPick(on ? '' : d)}
            className={cx(
              'group relative overflow-hidden rounded-xl border bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition',
              on ? 'border-transparent ring-2' : 'border-line hover:border-slate-300',
            )}
            style={on ? ({ '--tw-ring-color': s.hex } as CSSProperties) : undefined}
            aria-pressed={on}
          >
            <span className="absolute inset-x-0 top-0 h-1" style={{ background: s.hex }} />
            <div className="flex items-center gap-1.5">
              <span className={cx('h-2 w-2 rounded-full', s.dot)} />
              <span className={cx('truncate text-xs font-semibold', s.text)}>{s.short}</span>
            </div>
            <p className="tabular mt-1.5 text-2xl font-semibold text-ink">{fmtInt(n)}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-muted">{DECISION_HINT[d]}</p>
              <p className="tabular text-[11px] font-medium text-muted">{total ? Math.round((n / total) * 100) : 0}%</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode }) {
  return (
    <label className="relative min-w-0 flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx('h-9 w-full rounded-lg border bg-white pl-2.5 pr-7 text-sm sm:w-auto', value ? 'border-brand-500 text-ink' : 'border-line text-muted')}
      >
        {children}
      </select>
    </label>
  );
}

function SortHeader({ k, label, sort, onSort, className }: { k: SortKey; label: string; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort.key === k;
  return (
    <th className={cx('px-3 py-2.5 font-medium', className)}>
      <button onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')}>
        {label}
        {on ? sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : <span className="w-3" />}
      </button>
    </th>
  );
}

function IssueChip({ r }: { r: Result }) {
  const n = issueCount(r);
  if (!n) return null;
  const block = r.flags.some((f) => f.severity === 'block');
  return (
    <span
      title={r.flags.map((f) => f.message).join('\n')}
      className={cx('inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold', block ? 'bg-red-50 text-decline' : 'bg-amber-50 text-waitlist')}
    >
      <AlertTriangle size={10} />
      {n}
    </span>
  );
}

function PaybackCell({ r }: { r: Result }) {
  const p = r.economics.paybackMonths;
  if (p === null) return <span className="text-decline">No profit</span>;
  return <span className={cx(p > PAYBACK_TARGET_MONTHS ? 'text-decline' : 'text-ink')}>{fmtMonths(p)}</span>;
}

function nextStep(r: Result): string {
  if (r.decision === 'Hold' && r.asks.length) return `Ask: ${r.asks[0]}`;
  if (r.decision === 'Redirect' && r.redirect) return `Offer pin ${r.redirect.pin} (${r.redirect.pinName}), ${r.redirect.km.toFixed(1)} km away`;
  return r.nextSteps[0] ?? r.conditions[0]?.text ?? '—';
}

export function PipelinePage() {
  const { output, parse, openApplicant } = useApp();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [territory, setTerritory] = useState('');
  const [decision, setDecision] = useState<Decision | ''>('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'decision', desc: false });

  const results = output?.results ?? [];
  const appByUid = useMemo(() => new Map(parse?.applications.map((a) => [a.uid, a]) ?? []), [parse]);
  const cities = useMemo(() => [...new Set(results.map((r) => r.city))].sort(), [results]);
  const territories = useMemo(() => [...new Set(results.map((r) => r.territoryId).filter((t): t is string => !!t))].sort(), [results]);

  // Tile counts reflect every filter except the decision filter itself, so the tiles stay useful while filtering.
  const baseFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return results.filter((r) => {
      if (city && r.city !== city) return false;
      if (territory && (territory === '__none' ? r.territoryId : r.territoryId !== territory)) return false;
      if (issuesOnly && issueCount(r) === 0) return false;
      if (s) {
        const hay = `${r.appId} ${r.uid} ${r.name} ${r.pin ?? ''} ${r.place.pinName} ${r.city} ${appByUid.get(r.uid)?.currentBusiness ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [results, q, city, territory, issuesOnly, appByUid]);

  const searched = baseFiltered;

  const counts = useMemo(() => {
    const c = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<Decision, number>;
    for (const r of searched) c[r.decision]++;
    return c;
  }, [searched]);

  const rows = useMemo(() => {
    const list = decision ? searched.filter((r) => r.decision === decision) : searched.slice();
    list.sort((a, b) => {
      const v = compareResults(a, b, sort.key);
      return (sort.desc ? -v : v) || a.appId.localeCompare(b.appId, undefined, { numeric: true });
    });
    return list;
  }, [searched, decision, sort]);

  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: DEFAULT_DESC[k] }));
  const anyFilter = !!(q || city || territory || decision || issuesOnly);
  const clear = () => {
    setQ('');
    setCity('');
    setTerritory('');
    setDecision('');
    setIssuesOnly(false);
  };
  const exportCsv = () => {
    if (!output) return;
    downloadText(buildDecisionCsv(output.results, output.asOf), `StoreSense_decision_file_${output.asOf}.csv`);
  };
  const issueTotal = results.filter((r) => issueCount(r) > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Applications"
        subtitle={
          output ? (
            <>
              One decision per applicant, with the reasons and numbers behind it. Click any row for the full case.
            </>
          ) : (
            'Upload a file to see decisions.'
          )
        }
        actions={
          <Button variant="primary" onClick={exportCsv} disabled={!results.length}>
            <Download size={15} />
            Export decision file (CSV)
          </Button>
        }
      />

      <DecisionTiles counts={counts} active={decision} onPick={setDecision} />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ID, name, pin, area or business"
              className="h-9 w-full rounded-lg border border-line bg-white pl-8 pr-8 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter size={14} className="hidden text-muted lg:block" />
            <Select value={city} onChange={setCity} label="City">
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={territory} onChange={setTerritory} label="Territory">
              <option value="">All territories</option>
              <option value="__none">No territory</option>
              {territories.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select value={decision} onChange={(v) => setDecision(v as Decision | '')} label="Decision">
              <option value="">All decisions</option>
              {DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <button
              onClick={() => setIssuesOnly((v) => !v)}
              aria-pressed={issuesOnly}
              className={cx(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm',
                issuesOnly ? 'border-amber-300 bg-amber-50 text-waitlist' : 'border-line bg-white text-muted hover:text-ink',
              )}
            >
              <AlertTriangle size={14} />
              Data issues
              <span className="tabular text-xs">{issueTotal}</span>
            </button>
            {anyFilter && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
          <span className="tabular">
            Showing <span className="font-semibold text-ink">{rows.length}</span> of {results.length}
          </span>
          {output && <span className="hidden sm:inline">Decisions as of {output.asOf} · payback target {PAYBACK_TARGET_MONTHS} months</span>}
        </div>

        {!results.length ? (
          <EmptyState
            icon={<FileSpreadsheet size={36} />}
            title="No decisions yet"
            body={output ? 'The file loaded but no applications came out of the engine. Check the Data sources page for parse warnings.' : 'Upload an Applications + Territories file to start.'}
          />
        ) : !rows.length ? (
          <EmptyState icon={<Search size={32} />} title="No applicants match these filters" action={<Button onClick={clear}>Clear filters</Button>} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="border-y border-line bg-slate-50 text-left text-xs text-muted">
                  <tr>
                    <SortHeader k="appId" label="ID" sort={sort} onSort={onSort} className="pl-4" />
                    <SortHeader k="name" label="Applicant" sort={sort} onSort={onSort} />
                    <SortHeader k="city" label="City · pin" sort={sort} onSort={onSort} />
                    <SortHeader k="decision" label="Decision" sort={sort} onSort={onSort} />
                    <SortHeader k="partner" label="Partner" sort={sort} onSort={onSort} />
                    <SortHeader k="place" label="Place" sort={sort} onSort={onSort} className="text-right" />
                    <SortHeader k="payback" label="Payback" sort={sort} onSort={onSort} className="text-right" />
                    <SortHeader k="combined" label="Combined" sort={sort} onSort={onSort} className="text-right" />
                    <th className="px-3 py-2.5 font-medium">Next step</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const app = appByUid.get(r.uid);
                    return (
                      <tr key={r.uid} onClick={() => openApplicant(r.uid)} className="group cursor-pointer align-top hover:bg-slate-50">
                        <td className="tabular whitespace-nowrap py-3 pl-4 pr-3 font-medium text-ink">
                          <div className="flex items-center gap-1.5">
                            {r.appId}
                            <IssueChip r={r} />
                          </div>
                        </td>
                        <td className="max-w-[220px] px-3 py-3">
                          <p className="truncate font-medium text-ink">{r.name}</p>
                          <p className="truncate text-xs text-muted">{app?.currentBusiness || 'No business listed'}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p className="text-ink">{r.city}</p>
                          <p className="tabular text-xs text-muted">
                            {r.pin ?? 'pin ?'}
                            {r.place.pinName ? ` · ${r.place.pinName}` : ''}
                          </p>
                        </td>
                        <td className="max-w-[300px] px-3 py-3">
                          <DecisionBadge decision={r.decision} />
                          <p className="mt-1 line-clamp-2 text-xs text-muted">{r.headline}</p>
                        </td>
                        <td className="w-28 px-3 py-3">
                          <p className="tabular text-sm font-medium text-ink">{fmtScore(r.partnerScore)}</p>
                          <div className="mt-1">
                            <ScoreBar value={r.partnerScore} />
                          </div>
                        </td>
                        <td className="tabular px-3 py-3 text-right">{fmtScore(r.place.placeScore)}</td>
                        <td className="tabular whitespace-nowrap px-3 py-3 text-right">
                          <PaybackCell r={r} />
                        </td>
                        <td className="tabular px-3 py-3 text-right font-semibold text-ink">{r.combinedScore.toFixed(1)}</td>
                        <td className="max-w-[240px] px-3 py-3 text-xs text-muted">
                          <p className="line-clamp-2">{nextStep(r)}</p>
                        </td>
                        <td className="py-3 pr-3 text-slate-300 group-hover:text-muted">
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line border-t border-line md:hidden">
              {rows.map((r) => (
                <li key={r.uid}>
                  <button onClick={() => openApplicant(r.uid)} className="block w-full px-4 py-3 text-left active:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="tabular text-xs font-semibold text-muted">{r.appId}</span>
                          <IssueChip r={r} />
                        </div>
                        <p className="truncate font-medium text-ink">{r.name}</p>
                        <p className="tabular truncate text-xs text-muted">
                          {r.city} · {r.pin ?? 'pin ?'}
                          {r.place.pinName ? ` · ${r.place.pinName}` : ''}
                        </p>
                      </div>
                      <DecisionBadge decision={r.decision} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-ink">{r.headline}</p>
                    <div className="mt-2.5 grid grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <p className="text-muted">Partner</p>
                        <p className="tabular font-semibold text-ink">{fmtScore(r.partnerScore)}</p>
                        <div className="mt-0.5">
                          <ScoreBar value={r.partnerScore} />
                        </div>
                      </div>
                      <div>
                        <p className="text-muted">Place</p>
                        <p className="tabular font-semibold text-ink">{fmtScore(r.place.placeScore)}</p>
                      </div>
                      <div>
                        <p className="text-muted">Payback</p>
                        <p className="tabular font-semibold">
                          <PaybackCell r={r} />
                        </p>
                      </div>
                      <div>
                        <p className="text-muted">Combined</p>
                        <p className="tabular font-semibold text-ink">{r.combinedScore.toFixed(1)}</p>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-1 text-[11px] text-muted">
                      <span className="font-medium text-ink">Next: </span>
                      {nextStep(r)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
