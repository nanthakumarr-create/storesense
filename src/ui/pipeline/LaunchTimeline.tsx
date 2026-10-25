// Gantt-style launch timeline (bars over day 0..totalDays) and the ADKAR readiness profile.
import type { AdkarStage, LaunchPlan } from '../../types';
import { cx, fmtDate } from '../components/ui';

const PHASE_COLORS = ['#0f766e', '#0369a1', '#7c3aed', '#b45309', '#be185d', '#15803d', '#475569'];

function phaseColor(phases: string[], phase: string) {
  return PHASE_COLORS[phases.indexOf(phase) % PHASE_COLORS.length];
}

export function LaunchTimeline({ plan, compact }: { plan: LaunchPlan; compact?: boolean }) {
  const total = Math.max(1, plan.totalDays);
  const phases = [...new Set(plan.steps.map((s) => s.phase))];
  const ticks = Array.from({ length: Math.floor(total / 15) + 1 }, (_, i) => i * 15).filter((d) => d <= total);
  if (!plan.steps.length) return <p className="text-sm text-muted">No steps in this plan.</p>;

  return (
    <div>
      {/* Axis */}
      <div className={cx('grid gap-x-3', compact ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]')}>
        {!compact && <div className="hidden md:block" />}
        <div className="relative mb-1 h-4 text-[10px] text-muted">
          {ticks.map((d) => (
            <span key={d} className="tabular absolute -translate-x-1/2" style={{ left: `${(d / total) * 100}%` }}>
              {d === 0 ? 'Day 0' : d}
            </span>
          ))}
        </div>
      </div>
      <ul className="space-y-1.5">
        {plan.steps.map((s, i) => {
          const left = (Math.max(0, s.dayFrom) / total) * 100;
          const width = Math.max(1.5, ((Math.min(total, s.dayTo) - Math.max(0, s.dayFrom)) / total) * 100);
          const color = phaseColor(phases, s.phase);
          return (
            <li key={i} className={cx('grid items-center gap-x-3 gap-y-1', compact ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]')}>
              <div className="min-w-0">
                <p className={cx('truncate text-ink', compact ? 'text-xs' : 'text-sm')} title={s.task}>
                  {s.task}
                </p>
                <p className="tabular truncate text-[11px] text-muted">
                  {s.phase} · {s.owner} · due {fmtDate(s.dueDate)}
                </p>
              </div>
              <div className="relative h-5 rounded bg-slate-100">
                {ticks.map((d) => (
                  <span key={d} className="absolute inset-y-0 w-px bg-white" style={{ left: `${(d / total) * 100}%` }} />
                ))}
                <span
                  className="tabular absolute inset-y-0.5 flex items-center overflow-hidden rounded px-1 text-[10px] font-medium text-white"
                  style={{ left: `${left}%`, width: `${width}%`, background: color }}
                  title={`Day ${s.dayFrom}–${s.dayTo}`}
                >
                  <span className="truncate">
                    {s.dayFrom}–{s.dayTo}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted">
        <span className="tabular">Start {fmtDate(plan.startDate)}</span>
        <span className="tabular font-medium text-ink">Open {fmtDate(plan.targetOpenDate)}</span>
      </div>
    </div>
  );
}

const ADKAR_ORDER: AdkarStage[] = ['Awareness', 'Desire', 'Knowledge', 'Ability', 'Reinforcement'];

export function AdkarProfile({ plan }: { plan: LaunchPlan }) {
  const byStage = new Map(plan.adkar.map((a) => [a.stage, a]));
  return (
    <ul className="space-y-2.5">
      {ADKAR_ORDER.map((stage) => {
        const a = byStage.get(stage);
        const score = a?.score ?? 0;
        const weakest = stage === plan.weakestStage;
        return (
          <li key={stage}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={cx('font-medium', weakest ? 'text-waitlist' : 'text-ink')}>
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[11px] font-bold text-slate-600">{stage[0]}</span>
                {stage}
                {weakest && <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-waitlist">Weakest</span>}
              </span>
              <span className="tabular font-semibold text-ink">{a ? score.toFixed(0) : '—'}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full', weakest ? 'bg-waitlist' : score >= 70 ? 'bg-brand-600' : 'bg-sky-500')} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
            </div>
            {a?.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
