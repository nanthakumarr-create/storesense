// Overview: what the expansion head looks at first. Counts, the exceptions that need a human, charts, demand gaps, activity.
import { useMemo, type ReactNode } from 'react';
import {
  AlertCircle, ArrowRight, CalendarDays, CheckCircle2, FileSpreadsheet, History, MapPin, ShieldCheck, Upload, Users, ListChecks,
} from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Decision, Result } from '../../types';
import { Button, Card, CardHeader, DECISION_STYLE, DecisionBadge, EmptyState, PageHeader, Pill, cx, fmtDate, fmtInt, fmtKm } from '../components/ui';
import { DecisionsByCityChart, ScorePaybackScatter, TerritoryFillChart } from '../dashboard/charts';
import { EXISTING_STORES } from '../../data/existingStores';

const TILE_DECISIONS: { d: Decision; label: string }[] = [
  { d: 'Approve', label: 'Approved' },
  { d: 'Approve with conditions', label: 'Approved with conditions' },
  { d: 'Redirect', label: 'Redirected' },
  { d: 'Waitlist', label: 'Waitlisted' },
  { d: 'Hold', label: 'On hold' },
  { d: 'Decline', label: 'Declined' },
];

function Tile({ label, value, hint, accent, onClick, children }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string; onClick?: () => void; children?: ReactNode }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        onClick && 'transition-colors hover:border-slate-300 hover:bg-slate-50/60',
      )}
    >
      {accent && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold leading-none text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</p>}
      {children}
    </Tag>
  );
}

function ExceptionRow({ r, onOpen }: { r: Result; onOpen: () => void }) {
  const isHold = r.decision === 'Hold';
  const items = isHold ? r.asks : r.conditions.map((c) => `${c.text} (${c.deadlineDays} days, ${c.owner})`);
  return (
    <li>
      <button onClick={onOpen} className="group flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', isHold ? 'bg-slate-100 text-hold' : 'bg-sky-50 text-conditional')}>
          {isHold ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-xs font-semibold text-ink">{r.appId}</span>
            <span className="truncate text-sm text-ink">{r.name}</span>
            <DecisionBadge decision={r.decision} />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {r.city}
            {r.pin ? ` · ${r.pin}` : ''}
            {r.territoryId ? ` · ${r.territoryId}` : ''} · combined {r.combinedScore.toFixed(0)}
          </p>
          {items.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-700">
              <span className="font-medium">{isHold ? 'Ask for: ' : 'Condition: '}</span>
              {items.slice(0, 2).join(' · ')}
              {items.length > 2 && ` +${items.length - 2} more`}
            </p>
          ) : (
            <p className="mt-1 line-clamp-2 text-xs text-slate-700">{r.headline}</p>
          )}
        </div>
        <ArrowRight size={15} className="mt-1 shrink-0 text-slate-300 group-hover:text-muted" />
      </button>
    </li>
  );
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function OverviewPage() {
  const { output, parse, activity, setPage, openApplicant, isSample, loadSample } = useApp();

  const exceptions = useMemo(() => {
    if (!output) return { list: [] as Result[], holds: 0, conds: 0 };
    const holds = output.results.filter((r) => r.decision === 'Hold');
    const conds = output.results.filter((r) => r.decision === 'Approve with conditions');
    // Strongest first inside each kind; interleave so both kinds show in the top 8 when both exist.
    const byScore = (a: Result, b: Result) => b.combinedScore - a.combinedScore || a.appId.localeCompare(b.appId);
    const c = [...conds].sort(byScore);
    const h = [...holds].sort(byScore);
    const list: Result[] = [];
    while ((c.length || h.length) && list.length < 8) {
      if (c.length) list.push(c.shift()!);
      if (h.length && list.length < 8) list.push(h.shift()!);
    }
    return { list, holds: holds.length, conds: conds.length };
  }, [output]);

  if (!output || !parse) {
    return (
      <Card>
        <EmptyState icon={<FileSpreadsheet size={40} />} title="No file loaded yet" body="Upload the Applications and Territories file to see a decision for every applicant." action={<Button variant="primary" onClick={() => setPage('data')}>Upload file</Button>} />
      </Card>
    );
  }

  const s = output.summary;
  const results = output.results;
  const storesChecked = parse.stores.length || EXISTING_STORES.length;
  const pct = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}% of applications` : '—');
  const fillPct = s.slotsTotal ? (s.slotsFilled / s.slotsTotal) * 100 : 0;
  const noResults = results.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expansion overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={14} />{parse.source.fileName}{isSample && <Pill tone="warn">Sample</Pill>}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />Decisions as of {fmtDate(output.asOf)}</span>
            {output.hash && output.hash !== 'stub' && <span className="tabular text-xs text-slate-400">Run #{output.hash.slice(0, 8)}</span>}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setPage('pipeline')}><ListChecks size={15} />All decisions</Button>
            <Button variant="primary" onClick={() => setPage('data')}><Upload size={15} />Upload new file</Button>
          </>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        <Tile label="Applications" value={fmtInt(s.total)} hint={`${parse.territories.length} territories · ${s.dataIssues} data issues`} onClick={() => setPage('pipeline')} />
        {TILE_DECISIONS.map(({ d, label }) => (
          <Tile key={d} label={label} value={fmtInt(s.byDecision[d] ?? 0)} hint={pct(s.byDecision[d] ?? 0)} accent={DECISION_STYLE[d].hex} onClick={() => setPage('pipeline')} />
        ))}
        <Tile label="Slots filled" value={<>{s.slotsFilled}<span className="text-base font-medium text-muted"> / {s.slotsTotal}</span></>} onClick={() => setPage('territories')}>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${fillPct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{s.slotsTotal - s.slotsFilled} open across all territories</p>
        </Tile>
        <Tile
          label="Pin conflicts"
          value={
            <span className={cx('inline-flex items-center gap-1.5', s.pinConflicts === 0 ? 'text-approve' : 'text-decline')}>
              {s.pinConflicts}
              {s.pinConflicts === 0 ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
            </span>
          }
          hint={s.pinConflicts === 0 ? `Checked against ${storesChecked} existing stores and every approval` : 'Two stores share a pin. Check the decision table.'}
        />
      </div>

      {noResults && (
        <Card className="border-amber-200 bg-amber-50/50 p-4 text-sm text-waitlist">
          The file was read ({s.total} application rows), but the rules engine has not produced decisions yet. Charts and queues fill in as soon as it does.
        </Card>
      )}

      {/* Exceptions + decisions by city */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader
            title="Needs a human call"
            subtitle={`${exceptions.conds} approvals with conditions · ${exceptions.holds} on hold waiting for information`}
            action={<Button size="sm" variant="ghost" onClick={() => setPage('pipeline')}>See all<ArrowRight size={13} /></Button>}
          />
          {exceptions.list.length ? (
            <ul className="divide-y divide-line">
              {exceptions.list.map((r) => (
                <ExceptionRow key={r.uid} r={r} onOpen={() => openApplicant(r.uid)} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckCircle2 size={32} />} title="Nothing waiting on you" body="No holds or conditional approvals in this file. Every other decision follows the rules without a human call." />
          )}
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader title="Decisions by city" subtitle="How each city's applications were decided" />
          <div className="p-4">
            {noResults ? <EmptyState title="No decisions yet" /> : <DecisionsByCityChart results={results} />}
          </div>
        </Card>
      </div>

      {/* Scatter + territory fill */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader title="Partner strength vs store payback" subtitle="Each dot is one applicant. Good partners in places that pay back sit bottom-right." />
          <div className="p-4">
            {noResults ? <EmptyState title="No decisions yet" /> : <ScorePaybackScatter results={results} onPick={openApplicant} />}
          </div>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader
            title="Territory fill"
            subtitle={`${s.slotsFilled} of ${s.slotsTotal} open slots filled`}
            action={<Button size="sm" variant="ghost" onClick={() => setPage('territories')}>Details<ArrowRight size={13} /></Button>}
          />
          <div className="p-4">
            {output.territories.length ? (
              <TerritoryFillChart territories={output.territories} />
            ) : (
              <EmptyState title="No territories to show" body="Territories appear once the Territories sheet is read and the rules have run." />
            )}
          </div>
        </Card>
      </div>

      {/* Gaps + activity */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader
            title="Top demand gaps"
            subtitle="Pins with strong demand and no store nearby. Demand uses simulated online-order data."
            action={<Button size="sm" variant="ghost" onClick={() => setPage('map')}><MapPin size={13} />Open map</Button>}
          />
          {output.gaps.length ? <GapsTable /> : <EmptyState icon={<MapPin size={32} />} title="No open demand gaps" body="Every high-demand pin is covered by a store or an approved applicant." />}
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader title="Recent activity" subtitle="Uploads and chat updates, newest first" action={<History size={16} className="text-muted" />} />
          {activity.length ? (
            <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {activity.slice(0, 12).map((a, i) => (
                <li key={`${a.at}-${i}`} className="px-4 py-3">
                  <p className="text-[11px] text-muted">{timeLabel(a.at)}</p>
                  <p className="mt-0.5 text-sm text-ink">{a.text}</p>
                  {a.changes.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {a.changes.slice(0, 4).map((c) => (
                        <li key={c.uid}>
                          <button onClick={() => openApplicant(c.uid)} className="flex w-full flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                            <span className="font-semibold text-ink">{c.appId}</span>
                            <DecisionBadge decision={c.before} />
                            <ArrowRight size={12} className="text-muted" />
                            <DecisionBadge decision={c.after} />
                          </button>
                        </li>
                      ))}
                      {a.changes.length > 4 && <li className="text-[11px] text-muted">+{a.changes.length - 4} more decisions changed</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={<Users size={28} />} title="No activity yet" body="Ask StoreSense about an applicant or give it new information; changes show up here." />
          )}
        </Card>
      </div>

      {!isSample && (
        <p className="text-center text-xs text-muted">
          Want to compare with the demo file?{' '}
          <button className="font-medium text-brand-700 hover:underline" onClick={() => void loadSample()}>Load sample data</button>
        </p>
      )}
    </div>
  );
}

function GapsTable() {
  const { output, setPage } = useApp();
  const gaps = useMemo(() => [...(output?.gaps ?? [])].sort((a, b) => b.demandIndex - a.demandIndex).slice(0, 10), [output]);
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Pin</th>
              <th className="px-2 py-2 font-medium">Area</th>
              <th className="px-2 py-2 font-medium">City</th>
              <th className="px-2 py-2 text-right font-medium">Demand</th>
              <th className="px-2 py-2 text-right font-medium">Nearest store</th>
              <th className="px-2 py-2 text-right font-medium">Applicants</th>
              <th className="px-4 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {gaps.map((g) => (
              <tr key={g.pin} className="cursor-pointer hover:bg-slate-50" onClick={() => setPage('map')}>
                <td className="tabular px-4 py-2.5 font-semibold text-ink">{g.pin}</td>
                <td className="max-w-[160px] truncate px-2 py-2.5 text-ink">{g.name}</td>
                <td className="px-2 py-2.5 text-muted">{g.city}{g.territoryId ? ` · ${g.territoryId}` : ''}</td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 lg:block">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${g.demandIndex}%` }} />
                    </div>
                    <span className="tabular w-7 text-right font-medium">{g.demandIndex.toFixed(0)}</span>
                  </div>
                </td>
                <td className="tabular px-2 py-2.5 text-right">{fmtKm(g.nearestStoreKm)}</td>
                <td className="tabular px-2 py-2.5 text-right">{g.applicants}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{g.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <ul className="divide-y divide-line md:hidden">
        {gaps.map((g) => (
          <li key={g.pin}>
            <button className="w-full px-4 py-3 text-left" onClick={() => setPage('map')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink"><span className="tabular">{g.pin}</span> · {g.name}</span>
                <span className="tabular shrink-0 text-sm font-semibold text-brand-700">{g.demandIndex.toFixed(0)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{g.city}{g.territoryId ? ` · ${g.territoryId}` : ''} · nearest store {fmtKm(g.nearestStoreKm)} · {g.applicants} applicant{g.applicants === 1 ? '' : 's'}</p>
              {g.note && <p className="mt-1 text-xs text-slate-700">{g.note}</p>}
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Demand index 0–100 from simulated online orders (Bengaluru) or the tier proxy (other cities). Click a row to see it on the map.</p>
    </>
  );
}
