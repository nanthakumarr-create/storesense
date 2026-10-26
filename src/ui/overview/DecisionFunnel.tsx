// Decision summary: four outcome buttons that never overlap (so they add up to the file), each opening the
// matching list, plus two what-if sliders (minimum investment, minimum experience). The sliders never change a
// decision; they show how much of the pool would still clear a stricter bar, and what each city tier offers.
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Application, EngineOutput, Result, Tier } from '../../types';
import { cx, fmtLakh } from '../components/ui';
import type { DecisionFilter } from '../territories/helpers';

const OUTCOMES: { id: Exclude<DecisionFilter, 'all'>; label: string; tone: string; match: (r: Result) => boolean }[] = [
  { id: 'approved', label: 'Approved', tone: 'text-approve', match: (r) => r.decision === 'Approve' || r.decision === 'Approve with conditions' },
  { id: 'action', label: 'Needs action', tone: 'text-redirect', match: (r) => r.decision === 'Hold' || r.decision === 'Redirect' },
  { id: 'waitlist', label: 'Waitlist', tone: 'text-waitlist', match: (r) => r.decision === 'Waitlist' },
  { id: 'declined', label: 'Declined', tone: 'text-decline', match: (r) => r.decision === 'Decline' },
];

const TIERS: Tier[] = ['Tier 1', 'Tier 2', 'Tier 3'];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function Slider({ label, value, max, step, onChange, show }: { label: string; value: number; max: number; step: number; onChange: (v: number) => void; show: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-sm">
        <span className="text-ink">{label}</span>
        <span className="tabular font-semibold text-brand-700">{show(value)}</span>
      </span>
      <input type="range" min={0} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full cursor-pointer accent-brand-600" />
    </label>
  );
}

export function DecisionFunnel({ output, applications, onOpen }: { output: EngineOutput; applications: Application[]; onOpen: (f: DecisionFilter) => void }) {
  const appByUid = useMemo(() => new Map(applications.map((a) => [a.uid, a])), [applications]);
  const total = output.results.length;
  const by = output.summary.byDecision;

  const invs = applications.map((a) => a.investmentLakh).filter((v): v is number => v !== null);
  const exps = applications.map((a) => a.experienceYears).filter((v): v is number => v !== null);
  const maxInv = Math.max(10, Math.ceil(Math.max(0, ...invs) / 5) * 5);
  const maxExp = Math.max(5, Math.ceil(Math.max(0, ...exps)));

  const [minInv, setMinInv] = useState(0);
  const [minExp, setMinExp] = useState(0);
  const filtering = minInv > 0 || minExp > 0;

  // Blank values count as not meeting a bar above zero (the applicant has not shown it yet).
  const meets = (r: Result) => {
    const a = appByUid.get(r.uid);
    const inv = a?.investmentLakh ?? null;
    const exp = a?.experienceYears ?? null;
    return (minInv === 0 || (inv !== null && inv >= minInv)) && (minExp === 0 || (exp !== null && exp >= minExp));
  };

  const outcomes = OUTCOMES.map((o) => {
    const rows = output.results.filter(o.match);
    return { ...o, count: rows.length, meeting: rows.filter(meets).length };
  });
  const qualifying = outcomes.reduce((n, o) => n + o.meeting, 0);

  const tiers = TIERS.map((tier) => {
    const rows = output.results.filter((r) => r.economics.tier === tier);
    const inv = rows.map((r) => appByUid.get(r.uid)?.investmentLakh).filter((v): v is number => typeof v === 'number');
    const exp = rows.map((r) => appByUid.get(r.uid)?.experienceYears).filter((v): v is number => typeof v === 'number');
    const need = rows.find((r) => r.economics.totalCashNeedLakh > 0)?.economics.totalCashNeedLakh ?? null;
    return { tier, n: rows.length, inv: median(inv), exp: median(exp), need, enough: need === null ? 0 : inv.filter((v) => v >= need).length };
  }).filter((t) => t.n > 0);

  return (
    <div className="space-y-6 p-4">
      <div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {outcomes.map((o) => (
            <button
              key={o.id}
              onClick={() => onOpen(o.id)}
              className="group rounded-lg bg-slate-50 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:translate-y-0"
            >
              <span className="flex items-center justify-between text-sm text-muted group-hover:text-ink">
                {o.label} <ChevronRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className={cx('tabular mt-1 block text-2xl font-semibold', o.tone)}>{filtering ? o.meeting : o.count}</span>
              <span className="tabular block text-xs text-muted">
                {filtering ? `of ${o.count} meet your minimums` : o.id === 'approved' ? `${by.Approve} outright · ${by["Approve with conditions"]} conditional` : 'Open the list'}
              </span>
            </button>
          ))}
        </div>
        <p className="tabular mt-2 text-xs text-muted">
          {outcomes.map((o) => o.count).join(' + ')} = {total} applications. Each one is in exactly one group.
        </p>
      </div>

      <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm font-medium text-ink">What if we set minimums?</p>
          <Slider label="Investment of at least" value={minInv} max={maxInv} step={5} onChange={setMinInv} show={(v) => (v === 0 ? 'Any' : `₹${v}L`)} />
          <Slider label="Retail experience of at least" value={minExp} max={maxExp} step={1} onChange={setMinExp} show={(v) => (v === 0 ? 'Any' : `${v} yr${v === 1 ? '' : 's'}`)} />
          <p className="text-sm text-ink">
            <span className="tabular font-semibold">{qualifying}</span> of {total} applicants would qualify.{' '}
            {filtering && (
              <button className="font-medium text-brand-700 hover:underline" onClick={() => { setMinInv(0); setMinExp(0); }}>
                Reset
              </button>
            )}
          </p>
          <p className="text-xs text-muted">A what-if view only. Decisions still come from the rulebook.</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">What applicants bring, by city tier</p>
          {tiers.map((t) => (
            <p key={t.tier} className="tabular text-sm text-muted">
              <span className="font-medium text-ink">{t.tier}</span> · typical {fmtLakh(t.inv)} and {t.exp === null ? '—' : `${t.exp} yrs`} · {t.enough} of {t.n} have the {fmtLakh(t.need)} needed
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
