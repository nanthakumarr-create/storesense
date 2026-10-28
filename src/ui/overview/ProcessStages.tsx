// The six stages every batch goes through, as a calm stepper: horizontal on desktop, vertical on phones.
import { Check } from 'lucide-react';
import type { EngineOutput } from '../../types';
import { cx, fmtInt } from '../components/ui';

export interface Stage {
  n: number;
  title: string;
  count: number;
  unit: string;
  line: string;
  done: boolean;
}

export function buildStages(output: EngineOutput): Stage[] {
  const { results, summary } = output;
  const by = summary.byDecision;
  const withIssues = results.filter((r) => r.flags.some((f) => f.severity !== 'info')).length;
  const inTerritory = results.filter((r) => r.territoryId).length;
  const outside = summary.total - inTerritory;
  const plans = results.filter((r) => r.launchPlan).length;
  const approved = by.Approve + by['Approve with conditions'];
  const decidedLine = [
    `${approved} approved (${by.Approve} outright + ${by['Approve with conditions']} with conditions)`,
    `${by.Redirect} redirect`,
    `${by.Waitlist} waitlist`,
    `${by.Hold} hold`,
    `${by.Decline} decline`,
  ].join(' · ');
  return [
    { n: 1, title: 'Received', count: summary.total, unit: 'applications', line: 'Read from the uploaded file.', done: true },
    {
      n: 2,
      title: 'Data checked',
      count: withIssues,
      unit: 'with issues',
      line: `${by.Hold} on hold for missing or contradictory information. The rest were fixed by rule or are minor.`,
      done: true,
    },
    {
      n: 3,
      title: 'Matched to a territory',
      count: inTerritory,
      unit: 'in a territory',
      line: outside > 0 ? `${outside} asked for a pin outside every territory.` : 'Every applicant is in a territory.',
      done: true,
    },
    {
      n: 4,
      title: 'Scored and ranked',
      count: summary.total,
      unit: 'scored',
      line: 'Partner score, place score and payback, ranked within each territory.',
      done: true,
    },
    { n: 5, title: 'Decided', count: summary.total, unit: 'decisions', line: decidedLine, done: true },
    {
      n: 6,
      title: 'Onboarding',
      count: plans,
      unit: plans === 1 ? 'launch plan' : 'launch plans',
      line:
        plans > 0
          ? `60 to 90 day plans covering all ${approved} approved partners, outright and conditional. Starts when you confirm.`
          : 'No approved partners yet.',
      done: false,
    },
  ];
}

export function ProcessStages({ stages, onOpen }: { stages: Stage[]; onOpen: (n: number) => void }) {
  return (
    <ol className="grid grid-cols-1 lg:grid-cols-6">
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        return (
          <li key={s.n} className="relative">
            {/* connector: vertical on mobile, horizontal on desktop */}
            {!last && <span aria-hidden className="absolute left-6 top-9 -bottom-3 w-px bg-line lg:hidden" />}
            {!last && <span aria-hidden className="absolute left-9 -right-3 top-6 hidden h-px bg-line lg:block" />}
            <button
              onClick={() => onOpen(s.n)}
              className="group relative flex w-full gap-3 rounded-lg p-3 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:translate-y-0 lg:flex-col lg:gap-2"
              aria-label={`${s.title}: ${s.count} ${s.unit}. Open applications`}
            >
              <span
                className={cx(
                  'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-white',
                  s.done ? 'bg-brand-600 text-white' : 'border border-brand-600 bg-white text-brand-700',
                )}
              >
                {s.done ? <Check size={13} strokeWidth={3} /> : s.n}
              </span>
              <span className="min-w-0 lg:pr-3">
                <span className="block text-xs text-muted">Step {s.n}</span>
                <span className="block text-sm font-medium text-ink group-hover:text-brand-700">{s.title}</span>
                <span className="mt-1 block text-sm text-ink">
                  <span className="tabular font-semibold">{fmtInt(s.count)}</span> <span className="text-muted">{s.unit}</span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">{s.line}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
