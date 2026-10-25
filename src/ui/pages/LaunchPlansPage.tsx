// D4 · Launch plans: readiness plan for every approved / conditional partner.
import { useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ExternalLink, GraduationCap, Languages, PartyPopper, Rocket, Store, Target } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Decision, Result } from '../../types';
import { Button, Card, DecisionBadge, EmptyState, PageHeader, Pill, Stat, cx, fmtDate, fmtKm } from '../components/ui';
import { AdkarProfile, LaunchTimeline } from '../pipeline/LaunchTimeline';

type WithPlan = Result & { launchPlan: NonNullable<Result['launchPlan']> };
const APPROVED: Decision[] = ['Approve', 'Approve with conditions'];

function PlanCard({ r, open, onToggle }: { r: WithPlan; open: boolean; onToggle: () => void }) {
  const { openApplicant } = useApp();
  const p = r.launchPlan;
  return (
    <Card className={cx('overflow-hidden', open && 'ring-1 ring-brand-500/40')}>
      <button onClick={onToggle} className="block w-full p-4 text-left hover:bg-slate-50/60" aria-expanded={open}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-xs font-semibold text-muted">{r.appId}</span>
              <DecisionBadge decision={r.decision} />
              {r.conditions.length > 0 && <Pill tone="brand">{r.conditions.length} condition{r.conditions.length > 1 ? 's' : ''}</Pill>}
            </div>
            <p className="mt-1 truncate font-semibold text-ink">{r.name}</p>
            <p className="tabular truncate text-xs text-muted">
              {r.city} · {r.pin}
              {r.place.pinName ? ` · ${r.place.pinName}` : ''} · {r.territoryId ?? 'no territory'}
            </p>
          </div>
          <ChevronDown size={18} className={cx('mt-1 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Info icon={<CalendarDays size={13} />} label="Target open" value={fmtDate(p.targetOpenDate)} sub={`${p.totalDays}-day plan`} />
          <Info icon={<Languages size={13} />} label="Training language" value={p.trainingLanguage} />
          <Info icon={<Target size={13} />} label="Weakest ADKAR" value={p.weakestStage} warn />
          <Info icon={<Store size={13} />} label="Shadow store" value={p.shadowStore?.id ?? '—'} sub={p.shadowStore ? `${p.shadowStore.area} · ${fmtKm(p.shadowStore.km)}` : 'None nearby'} />
        </div>
        {/* Mini progress strip: plan length relative to a 120-day max */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (p.totalDays / 120) * 100)}%` }} />
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line bg-slate-50/50 p-4">
          {p.festivalNote && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-waitlist">
              <PartyPopper size={16} className="mt-0.5 shrink-0" />
              <span>{p.festivalNote}</span>
            </div>
          )}
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-ink">Timeline · {p.steps.length} steps</p>
            <LaunchTimeline plan={p} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-ink">ADKAR readiness profile</p>
              <AdkarProfile plan={p} />
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <GraduationCap size={16} className="text-brand-700" /> Training and preparation
              </p>
              {p.training.length ? (
                <ul className="space-y-1.5">
                  {p.training.map((t, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink">
                      <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Standard training only.</p>
              )}
              {r.conditions.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Conditions to clear</p>
                  <ul className="space-y-1.5">
                    {r.conditions.map((c) => (
                      <li key={c.code} className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm text-ink">
                        {c.text}
                        <span className="tabular ml-1 text-xs text-muted">
                          · {c.owner} · {c.deadlineDays} days
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => openApplicant(r.uid)}>
              <ExternalLink size={13} /> Full applicant case
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Info({ icon, label, value, sub, warn }: { icon: ReactNode; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </p>
      <p className={cx('tabular mt-0.5 truncate text-sm font-semibold', warn ? 'text-waitlist' : 'text-ink')}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export function LaunchPlansPage() {
  const { output, setPage } = useApp();
  const [city, setCity] = useState('');
  const [decision, setDecision] = useState('');
  const [lang, setLang] = useState('');
  const [openUid, setOpenUid] = useState<string | null>(null);

  const all = useMemo(
    () =>
      (output?.results ?? [])
        .filter((r): r is WithPlan => APPROVED.includes(r.decision) && !!r.launchPlan)
        .sort((a, b) => a.launchPlan.targetOpenDate.localeCompare(b.launchPlan.targetOpenDate) || a.appId.localeCompare(b.appId, undefined, { numeric: true })),
    [output],
  );
  const cities = useMemo(() => [...new Set(all.map((r) => r.city))].sort(), [all]);
  const langs = useMemo(() => [...new Set(all.map((r) => r.launchPlan.trainingLanguage))].sort(), [all]);
  const rows = all.filter((r) => (!city || r.city === city) && (!decision || r.decision === decision) && (!lang || r.launchPlan.trainingLanguage === lang));

  const avgDays = all.length ? Math.round(all.reduce((s, r) => s + r.launchPlan.totalDays, 0) / all.length) : 0;
  const firstOpen = all[0]?.launchPlan.targetOpenDate;
  const stageCounts = all.reduce<Record<string, number>>((m, r) => ((m[r.launchPlan.weakestStage] = (m[r.launchPlan.weakestStage] ?? 0) + 1), m), {});
  const topStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0];
  const festival = all.filter((r) => r.launchPlan.festivalNote).length;

  const sel = 'h-9 min-w-0 flex-1 rounded-lg border border-line bg-white pl-2.5 pr-7 text-sm sm:flex-none';

  return (
    <div className="space-y-4">
      <PageHeader title="Launch plans" subtitle="60–120 day readiness plan for every approved partner: steps, owners, due dates and the ADKAR gap to close." />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Partners in launch" value={all.length} hint={`${all.filter((r) => r.decision === 'Approve').length} approved · ${all.filter((r) => r.decision !== 'Approve').length} conditional`} icon={<Rocket size={16} />} />
        <Stat label="Avg plan length" value={all.length ? `${avgDays} d` : '—'} hint="Space ready 60–75 d · no site 90–120 d" icon={<CalendarDays size={16} />} />
        <Stat label="First opening" value={firstOpen ? fmtDate(firstOpen) : '—'} hint={festival ? `${festival} plan(s) shifted for festivals` : 'No festival shifts'} icon={<PartyPopper size={16} />} />
        <Stat label="Most common gap" value={topStage ? topStage[0] : '—'} hint={topStage ? `Weakest ADKAR stage for ${topStage[1]} partner(s)` : undefined} tone="warn" icon={<Target size={16} />} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <select value={city} onChange={(e) => setCity(e.target.value)} className={sel} aria-label="City">
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={decision} onChange={(e) => setDecision(e.target.value)} className={sel} aria-label="Decision">
            <option value="">Approved + conditional</option>
            {APPROVED.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className={sel} aria-label="Training language">
            <option value="">All languages</option>
            {langs.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <span className="tabular ml-auto text-xs text-muted">
            Showing <span className="font-semibold text-ink">{rows.length}</span> of {all.length}
          </span>
        </div>
        {!all.length ? (
          <EmptyState
            icon={<Rocket size={36} />}
            title="No approved partners yet"
            body="Launch plans appear here once an applicant is approved or approved with conditions."
            action={<Button onClick={() => setPage('pipeline')}>Go to applications</Button>}
          />
        ) : !rows.length ? (
          <EmptyState
            title="No plans match these filters"
            action={
              <Button
                onClick={() => {
                  setCity('');
                  setDecision('');
                  setLang('');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 p-3 xl:grid-cols-2">
            {rows.map((r) => (
              <div key={r.uid} className={cx(openUid === r.uid && 'xl:col-span-2')}>
                <PlanCard r={r} open={openUid === r.uid} onToggle={() => setOpenUid((u) => (u === r.uid ? null : r.uid))} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
