// Applicant detail: the full case for one application, answering the brief's questions in order.
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleHelp, ClipboardList, GraduationCap, History, Info,
  MapPin, MessageSquare, Navigation, RefreshCcw, Rocket, Scale, Store, Wallet, X,
} from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Application, DataFlag, Result } from '../../types';
import { Button, DECISION_STYLE, DecisionBadge, Pill, ScoreBar, cx, fmtDate, fmtKm, fmtLakh } from './ui';
import { PAYBACK_TARGET_MONTHS } from '../../config/rules';
import { fmtMonths, fmtScore } from '../pipeline/helpers';
import { LaunchTimeline } from '../pipeline/LaunchTimeline';
import type { Decision } from '../../types';

const DRAFT_VERB: Record<Decision, string> = {
  Approve: 'approved',
  'Approve with conditions': 'approved with conditions',
  Redirect: 'redirected',
  Waitlist: 'waitlisted',
  Hold: 'on hold',
  Decline: 'declined',
};

function Section({ title, icon, children, tone }: { title: string; icon: ReactNode; children: ReactNode; tone?: 'hold' }) {
  return (
    <section className={cx('rounded-xl border p-4', tone === 'hold' ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-white')}>
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className={cx(tone === 'hold' ? 'text-waitlist' : 'text-brand-700')}>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bullets({ items, empty, marker = 'dot' }: { items: string[]; empty?: string; marker?: 'dot' | 'num' | 'check' }) {
  if (!items.length) return <p className="text-sm text-muted">{empty ?? 'Nothing here.'}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink">
          {marker === 'num' ? (
            <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
          ) : marker === 'check' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand-600" />
          ) : (
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
          )}
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function KV({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className={cx('tabular mt-0.5 truncate text-sm font-semibold', tone === 'good' ? 'text-approve' : tone === 'bad' ? 'text-decline' : tone === 'warn' ? 'text-waitlist' : 'text-ink')}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function WhatHappens({ r }: { r: Result }) {
  const s = DECISION_STYLE[r.decision];
  return (
    <section className={cx('rounded-xl p-4 ring-1 ring-inset', s.bg)}>
      <p className={cx('text-xs font-semibold uppercase tracking-wide', s.text)}>What happens</p>
      <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{r.headline}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV label="Decision" value={<span className={s.text}>{r.decision}</span>} />
        <KV label="Territory" value={r.territoryId ?? 'None'} sub={r.place.territoryPriority ? `${r.place.territoryPriority} priority` : 'Pin not in any territory'} />
        <KV label="Rank in territory" value={r.rankInTerritory ? `#${r.rankInTerritory}` : '—'} sub={`Combined ${r.combinedScore.toFixed(1)}`} />
      </div>
      {r.redirect && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-violet-200 bg-white p-3">
          <Navigation size={18} className="mt-0.5 shrink-0 text-redirect" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">
              Offered pin <span className="tabular">{r.redirect.pin}</span> · {r.redirect.pinName}
            </p>
            <p className="tabular text-xs text-muted">
              {r.redirect.km.toFixed(1)} km from their pin · {r.redirect.territoryId} · demand index {r.redirect.demandIndex.toFixed(0)} · payback{' '}
              {fmtMonths(r.redirect.paybackMonths)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Scores({ r }: { r: Result }) {
  const p = r.place;
  return (
    <Section title="Scores" icon={<Scale size={16} />}>
      <div className="grid grid-cols-3 gap-2">
        <KV label="Partner (50%)" value={fmtScore(r.partnerScore)} tone={r.partnerScore >= 70 ? 'good' : r.partnerScore >= 55 ? 'warn' : 'bad'} />
        <KV label="Place (30%)" value={fmtScore(p.placeScore)} />
        <KV label="Readiness (20%)" value={fmtScore(r.readiness)} />
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2">
        <span className="text-xs text-muted">Combined score (used to rank competing applicants)</span>
        <span className="tabular text-base font-semibold text-ink">{r.combinedScore.toFixed(2)}</span>
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Partner score breakdown</p>
      {r.partnerBreakdown.length ? (
        <ul className="space-y-2.5">
          {r.partnerBreakdown.map((b) => (
            <li key={b.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink">
                  {b.label} <span className="text-xs text-muted">· {Math.round(b.weight * 100)}%</span>
                </span>
                <span className="tabular font-semibold text-ink">{b.score.toFixed(0)}</span>
              </div>
              <div className="mt-1">
                <ScoreBar value={b.score} />
              </div>
              <p className="mt-1 text-xs text-muted">{b.note}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No breakdown available.</p>
      )}

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Place</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV label="Demand index" value={p.demandIndex.toFixed(0)} sub={p.demandSource === 'orders' ? 'Simulated order data' : 'Demand proxy v1'} />
        <KV label="Unserved demand" value={p.unservedNorm.toFixed(0)} sub="100 = far from stores" />
        <KV
          label="Nearest store"
          value={p.nearestStore ? fmtKm(p.nearestStore.km) : '—'}
          sub={p.nearestStore ? `${p.nearestStore.id} · ${p.nearestStore.area}` : 'No store in city'}
        />
        <KV
          label="Overlap radius"
          value={fmtKm(p.overlapRadiusKm)}
          sub={p.insideOverlapRadius ? 'Inside: catchment check' : 'Outside'}
          tone={p.insideOverlapRadius ? 'warn' : 'good'}
        />
        <KV label="Same pin as" value={p.samePinAsStore ?? 'None'} tone={p.samePinAsStore ? 'bad' : undefined} />
        <KV label="Location" value={p.locationApproximate ? 'Approximate' : 'Pin centroid'} sub={p.locationApproximate ? 'City centre used' : undefined} />
      </div>
    </Section>
  );
}

function PnL({ r, capacity }: { r: Result; capacity: number | null }) {
  const e = r.economics;
  const rows: { label: string; value: ReactNode; note?: string; tone?: 'good' | 'bad' }[] = [
    { label: 'Investment needed', value: fmtLakh(e.requiredInvestmentLakh), note: e.tier },
    { label: 'Cash buffer (3 months fixed cost)', value: fmtLakh(e.bufferLakh) },
    {
      label: 'Total cash need vs capacity',
      value: (
        <>
          {fmtLakh(e.totalCashNeedLakh)}
          <span className="text-muted"> vs </span>
          <span className={e.capitalGapLakh > 0 ? 'text-decline' : 'text-approve'}>{capacity === null ? 'blank' : fmtLakh(capacity)}</span>
        </>
      ),
      note: 'investment + buffer',
    },
    { label: 'Monthly sales (est.)', value: fmtLakh(e.monthlySalesLakh), note: `Floor factor ×${e.floorFactor.toFixed(2)}` },
    { label: 'Monthly fixed cost', value: fmtLakh(e.monthlyFixedCostLakh) },
    { label: 'Monthly profit', value: fmtLakh(e.monthlyProfitLakh), tone: e.monthlyProfitLakh > 0 ? 'good' : 'bad' },
    {
      label: `Payback vs ${PAYBACK_TARGET_MONTHS}-month target`,
      value: e.paybackMonths === null ? 'Never' : fmtMonths(e.paybackMonths),
      tone: e.paybackPass ? 'good' : 'bad',
      note: e.paybackPass ? 'Pass' : 'Fail',
    },
    {
      label: 'Capital gap',
      value: e.capitalGapLakh > 0 ? `${fmtLakh(e.capitalGapLakh)} (${Math.round(e.capitalGapPct * 100)}%)` : 'None',
      tone: e.capitalGapLakh > 0 ? 'bad' : 'good',
    },
  ];
  return (
    <Section title="Store P&L (estimate)" icon={<Wallet size={16} />}>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-1.5 pr-2 text-muted">
                {row.label}
                {row.note && <span className="ml-1 text-[11px] text-slate-400">· {row.note}</span>}
              </td>
              <td className={cx('tabular whitespace-nowrap py-1.5 text-right font-medium', row.tone === 'good' ? 'text-approve' : row.tone === 'bad' ? 'text-decline' : 'text-ink')}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Rulebook assumptions (35% contribution margin, tier base sales). To be checked against existing stores in the pilot.</p>
    </Section>
  );
}

const FLAG_TONE: Record<DataFlag['severity'], string> = {
  block: 'border-red-200 bg-red-50 text-decline',
  ask: 'border-amber-200 bg-amber-50 text-waitlist',
  info: 'border-line bg-slate-50 text-slate-600',
};

function Flags({ flags }: { flags: DataFlag[] }) {
  if (!flags.length) return null;
  return (
    <Section title={`Data flags (${flags.length})`} icon={<AlertTriangle size={16} />}>
      <ul className="space-y-1.5">
        {flags.map((f, i) => (
          <li key={i} className={cx('rounded-lg border px-3 py-2 text-sm', FLAG_TONE[f.severity])}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase">{f.code}</span>
              <span className="text-[10px] uppercase opacity-70">{f.severity}</span>
            </div>
            <p className="mt-0.5 text-ink">{f.message}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'blank' : String(v));

function History_({ app }: { app: Application | undefined }) {
  const ups = app?.updates ?? [];
  if (!ups.length) return null;
  return (
    <Section title="Update history" icon={<History size={16} />}>
      <ol className="relative space-y-3 border-l border-line pl-4">
        {ups
          .slice()
          .reverse()
          .map((u, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" />
              <p className="text-ink">
                <span className="font-medium">{u.field}</span>: <span className="text-muted line-through">{show(u.from)}</span>{' '}
                <ArrowRight size={12} className="inline" /> <span className="font-medium">{show(u.to)}</span>
              </p>
              <p className="text-xs text-muted">
                “{u.source}” · {new Date(u.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </li>
          ))}
      </ol>
    </Section>
  );
}

function Profile({ app }: { app: Application | undefined }) {
  if (!app) return null;
  const items: [string, ReactNode][] = [
    ['Investment', app.investmentLakh === null ? 'blank' : fmtLakh(app.investmentLakh)],
    ['Experience', app.experienceYears === null ? 'blank' : `${app.experienceYears} yrs`],
    ['Space', app.spaceAvailable ?? 'blank'],
    ['Size', app.spaceSizeSqft === null ? 'blank' : `${app.spaceSizeSqft} sq ft`],
    ['Floor', app.floor ?? 'blank'],
    ['Launch in', app.targetLaunchMonths === null ? 'blank' : `${app.targetLaunchMonths} mo`],
    ['Language', app.preferredLanguage ?? (app.languageRaw || 'blank')],
    ['Excel row', app.rowNumber],
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-line bg-white p-3 text-xs sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="text-muted">{k}</p>
            <p className={cx('tabular truncate font-medium', v === 'blank' ? 'italic text-slate-400' : 'text-ink')}>{v}</p>
          </div>
        ))}
      </div>
      {(app.currentBusiness || app.notes) && (
        <div className="rounded-xl border border-line bg-white p-3 text-xs">
          {app.currentBusiness && (
            <p>
              <span className="text-muted">Business: </span>
              <span className="text-ink">{app.currentBusiness}</span>
            </p>
          )}
          {app.notes && (
            <p className="mt-1">
              <span className="text-muted">Notes: </span>
              <span className="italic text-ink">“{app.notes}”</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ApplicantDrawer() {
  const { selectedUid, openApplicant, resultByUid, parse, setPage, setDraftQuestion } = useApp();
  const r = selectedUid ? resultByUid(selectedUid) : undefined;
  const app = useMemo(() => parse?.applications.find((a) => a.uid === selectedUid), [parse, selectedUid]);

  useEffect(() => {
    if (!selectedUid) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openApplicant(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedUid, openApplicant]);

  if (!selectedUid) return null;

  const goPlans = () => {
    openApplicant(null);
    setPage('plans');
  };

  return (
    <div className="fixed inset-0 z-[1100]" role="dialog" aria-modal="true" aria-label="Applicant detail">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => openApplicant(null)} />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-canvas shadow-2xl sm:max-w-[640px]">
        {/* Header */}
        <header className="border-b border-line bg-white px-4 py-3.5 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{r?.appId ?? selectedUid}</span>
                {r && <DecisionBadge decision={r.decision} size="md" />}
              </div>
              <h2 className="mt-1.5 truncate text-lg font-semibold text-ink">{r?.name ?? app?.name ?? 'Unknown applicant'}</h2>
              {r && (
                <p className="tabular flex flex-wrap items-center gap-1 text-xs text-muted">
                  <MapPin size={12} />
                  {r.city} · {r.pin ?? `pin unreadable (“${app?.pinRaw ?? ''}”)`}
                  {r.place.pinName ? ` · ${r.place.pinName}` : ''}
                </p>
              )}
            </div>
            <button onClick={() => openApplicant(null)} className="rounded-lg p-1.5 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        {!r ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <CircleHelp size={32} className="text-slate-300" />
            <p className="text-sm font-semibold text-ink">No decision for this applicant</p>
            <p className="max-w-xs text-sm text-muted">The record may have been removed by a new upload. Close this panel and pick another applicant.</p>
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
            <WhatHappens r={r} />
            <Profile app={app} />

            <Section title="Why" icon={<Info size={16} />}>
              <Bullets items={r.reasons} empty="No reasons recorded." />
              {r.reasonCodes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {r.reasonCodes.map((c) => (
                    <Pill key={c}>
                      <span className="font-mono">{c}</span>
                    </Pill>
                  ))}
                </div>
              )}
            </Section>

            {r.asks.length > 0 && (
              <Section title="Information to request" icon={<ClipboardList size={16} />} tone={r.decision === 'Hold' ? 'hold' : undefined}>
                <Bullets items={r.asks} marker="num" />
                {app?.preferredLanguage && app.preferredLanguage !== 'English' && (
                  <p className="mt-2 text-xs text-muted">Send the request in {app.preferredLanguage}.</p>
                )}
              </Section>
            )}

            <Section title="What they do next" icon={<ArrowRight size={16} />}>
              <Bullets items={r.nextSteps} marker="num" empty="No next steps." />
              {r.conditions.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Conditions ({r.conditions.length})</p>
                  <ul className="space-y-2">
                    {r.conditions.map((c) => (
                      <li key={c.code} className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
                        <p className="text-sm text-ink">{c.text}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Pill tone="brand">
                            <CalendarClock size={11} />
                            {c.deadlineDays} days
                          </Pill>
                          <Pill>Owner: {c.owner}</Pill>
                          <Pill>
                            <span className="font-mono">{c.code}</span>
                          </Pill>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Section title="How we'll prepare them" icon={<GraduationCap size={16} />}>
              <Bullets items={r.preparation} marker="check" empty="Preparation starts only once the applicant is approved." />
              {r.launchPlan && (
                <button onClick={goPlans} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  Open the full launch plan <ArrowRight size={14} />
                </button>
              )}
            </Section>

            {r.launchPlan && (
              <Section title={`Launch plan · ${r.launchPlan.totalDays} days`} icon={<Rocket size={16} />}>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <KV label="Target open" value={fmtDate(r.launchPlan.targetOpenDate)} />
                  <KV label="Training language" value={r.launchPlan.trainingLanguage} />
                  <KV label="Weakest ADKAR" value={r.launchPlan.weakestStage} tone="warn" />
                  <KV label="Shadow store" value={r.launchPlan.shadowStore?.id ?? '—'} sub={r.launchPlan.shadowStore ? `${r.launchPlan.shadowStore.area} · ${fmtKm(r.launchPlan.shadowStore.km)}` : undefined} />
                </div>
                <LaunchTimeline plan={r.launchPlan} compact />
                {r.launchPlan.festivalNote && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-waitlist">{r.launchPlan.festivalNote}</p>}
              </Section>
            )}

            <Section title="What would change this decision" icon={<RefreshCcw size={16} />}>
              <Bullets items={r.whatWouldChange} empty="Nothing obvious: the decision is stable." />
            </Section>

            <Scores r={r} />
            <PnL r={r} capacity={app?.investmentLakh ?? null} />
            <Flags flags={r.flags} />
            <History_ app={app} />
            <p className="flex items-center gap-1.5 px-1 pb-2 text-[11px] text-muted">
              <Store size={12} /> Decided by fixed rules (same file, same answer). AI only phrases chat answers.
            </p>
          </div>
        )}

        {r && (
          <footer className="flex items-center justify-between gap-2 border-t border-line bg-white px-4 py-3 sm:px-5">
            <span className="tabular hidden text-xs text-muted sm:inline">Row {app?.rowNumber ?? '—'} in the uploaded file</span>
            <div className="flex flex-1 justify-end gap-2 sm:flex-none">
              <Button onClick={() => openApplicant(null)}>Close</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setDraftQuestion(`Why is ${r.appId} ${DRAFT_VERB[r.decision] ?? 'decided this way'}?`);
                  openApplicant(null);
                  setPage('ask');
                }}
              >
                <MessageSquare size={15} />
                Ask about this applicant
              </Button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}
