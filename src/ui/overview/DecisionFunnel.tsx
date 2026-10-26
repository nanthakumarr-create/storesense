// Decision funnel: one stacked bar of mutually exclusive outcomes that always adds up to the file, plus two
// what-if sliders (minimum investment, minimum experience). The sliders never change a decision; they show how
// much of each outcome would still clear a stricter or looser bar, and what the pool actually offers.
import { useMemo, useState } from 'react';
import type { Application, EngineOutput, Result, Tier } from '../../types';
import { CITY_TIER } from '../../config/rules';
import { cx, fmtLakh } from '../components/ui';

type BucketId = 'approve' | 'conditional' | 'action' | 'waitlist' | 'decline';

const BUCKETS: { id: BucketId; label: string; color: string; match: (r: Result) => boolean }[] = [
  { id: 'approve', label: 'Approved outright', color: 'var(--color-approve)', match: (r) => r.decision === 'Approve' },
  { id: 'conditional', label: 'Approved with conditions', color: 'var(--color-conditional)', match: (r) => r.decision === 'Approve with conditions' },
  { id: 'action', label: 'Needs action (hold or redirect)', color: 'var(--color-redirect)', match: (r) => r.decision === 'Hold' || r.decision === 'Redirect' },
  { id: 'waitlist', label: 'Waitlist', color: 'var(--color-waitlist)', match: (r) => r.decision === 'Waitlist' },
  { id: 'decline', label: 'Declined', color: 'var(--color-decline)', match: (r) => r.decision === 'Decline' },
];

const TIERS: Tier[] = ['Tier 1', 'Tier 2', 'Tier 3'];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const fmtYears = (v: number | null) => (v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)} yrs`);

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular font-semibold text-brand-700">{show(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-brand-600" />
      <span className="tabular flex justify-between text-[11px] text-muted">
        <span>{show(min)}</span>
        <span>{show(max)}</span>
      </span>
    </label>
  );
}

export function DecisionFunnel({ output, applications }: { output: EngineOutput; applications: Application[] }) {
  const appByUid = useMemo(() => new Map(applications.map((a) => [a.uid, a])), [applications]);
  const total = output.results.length;

  const invs = applications.map((a) => a.investmentLakh).filter((v): v is number => v !== null);
  const exps = applications.map((a) => a.experienceYears).filter((v): v is number => v !== null);
  const maxInv = Math.max(10, Math.ceil(Math.max(0, ...invs) / 5) * 5);
  const maxExp = Math.max(5, Math.ceil(Math.max(0, ...exps)));

  const [minInv, setMinInv] = useState(0);
  const [minExp, setMinExp] = useState(0);

  // Blank values count as not meeting a bar above zero (the applicant has not shown it yet).
  const meets = (r: Result) => {
    const a = appByUid.get(r.uid);
    const inv = a?.investmentLakh ?? null;
    const exp = a?.experienceYears ?? null;
    return (minInv === 0 || (inv !== null && inv >= minInv)) && (minExp === 0 || (exp !== null && exp >= minExp));
  };

  const buckets = BUCKETS.map((b) => {
    const rows = output.results.filter(b.match);
    return { ...b, count: rows.length, meeting: rows.filter(meets).length };
  });
  const sum = buckets.reduce((n, b) => n + b.count, 0);
  const qualifying = buckets.reduce((n, b) => n + b.meeting, 0);
  const approved = buckets[0].count + buckets[1].count;
  const approvedMeeting = buckets[0].meeting + buckets[1].meeting;
  const filtering = minInv > 0 || minExp > 0;

  // What the pool offers, per city tier: is Tier 1 capital actually higher than Tier 3?
  const byTier = TIERS.map((tier) => {
    const rows = output.results.filter((r) => (r.economics.tier ?? CITY_TIER[r.city as keyof typeof CITY_TIER]) === tier);
    const inv = rows.map((r) => appByUid.get(r.uid)?.investmentLakh).filter((v): v is number => typeof v === 'number');
    const exp = rows.map((r) => appByUid.get(r.uid)?.experienceYears).filter((v): v is number => typeof v === 'number');
    const need = rows.find((r) => r.economics.totalCashNeedLakh > 0)?.economics.totalCashNeedLakh ?? null;
    return {
      tier,
      n: rows.length,
      invMed: median(inv),
      invMin: inv.length ? Math.min(...inv) : null,
      invMax: inv.length ? Math.max(...inv) : null,
      expMed: median(exp),
      expMin: exp.length ? Math.min(...exp) : null,
      expMax: exp.length ? Math.max(...exp) : null,
      need,
      enough: need === null ? null : inv.filter((v) => v >= need).length,
    };
  }).filter((t) => t.n > 0);

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p className="text-ink">
            <span className="tabular font-semibold">{approved}</span> approved{' '}
            <span className="text-muted">
              = {buckets[0].count} outright + {buckets[1].count} with conditions
            </span>
          </p>
          <p className={cx('tabular text-xs', sum === total ? 'text-muted' : 'font-medium text-decline')}>
            {buckets.map((b) => b.count).join(' + ')} = {sum} of {total} applications
          </p>
        </div>
        <div className="mt-2 flex h-7 w-full overflow-hidden rounded-md bg-slate-100" role="img" aria-label={buckets.map((b) => `${b.label} ${b.count}`).join(', ')}>
          {buckets.map((b) =>
            b.count ? (
              <div key={b.id} className="flex h-full transition-[width] duration-300" style={{ width: `${(b.count / Math.max(1, total)) * 100}%` }} title={`${b.label}: ${b.count}${filtering ? ` (${b.meeting} meet your minimums)` : ''}`}>
                <div className="h-full transition-[width] duration-300" style={{ width: `${b.count ? (b.meeting / b.count) * 100 : 0}%`, background: b.color }} />
                <div className="h-full flex-1 opacity-25" style={{ background: b.color }} />
              </div>
            ) : null,
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {buckets.map((b) => (
            <li key={b.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
              {b.label} <span className="tabular font-medium text-ink">{filtering ? `${b.meeting} of ${b.count}` : b.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4 rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs text-muted">
            What if the brand set minimums? Move a slider to see how the pool shrinks. This is a what-if view: decisions still come from the rulebook.
          </p>
          <Slider label="Minimum investment capacity" value={minInv} min={0} max={maxInv} step={5} onChange={setMinInv} show={(v) => (v === 0 ? 'No minimum' : `₹${v}L`)} />
          <Slider label="Minimum retail experience" value={minExp} min={0} max={maxExp} step={1} onChange={setMinExp} show={(v) => (v === 0 ? 'No minimum' : `${v} yr${v === 1 ? '' : 's'}`)} />
          <p className="text-sm text-ink">
            <span className="tabular font-semibold">{qualifying}</span> of {total} applicants meet these minimums
            {filtering && (
              <>
                , including <span className="tabular font-semibold">{approvedMeeting}</span> of the {approved} approved
              </>
            )}
            .
          </p>
          {filtering && (
            <button
              className="text-xs font-medium text-brand-700 hover:underline"
              onClick={() => {
                setMinInv(0);
                setMinExp(0);
              }}
            >
              Clear minimums
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <p className="mb-2 text-xs text-muted">What the pool offers by city tier (median, with the range in brackets)</p>
          <table className="tabular w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-1.5 pr-3 font-medium">Tier</th>
                <th className="py-1.5 pr-3 font-medium">Applicants</th>
                <th className="py-1.5 pr-3 font-medium">Capital</th>
                <th className="py-1.5 pr-3 font-medium">Experience</th>
                <th className="py-1.5 font-medium">Cash need met</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byTier.map((t) => (
                <tr key={t.tier}>
                  <td className="py-2 pr-3 text-ink">{t.tier}</td>
                  <td className="py-2 pr-3">{t.n}</td>
                  <td className="py-2 pr-3">
                    {fmtLakh(t.invMed)} <span className="text-xs text-muted">({fmtLakh(t.invMin)}–{fmtLakh(t.invMax)})</span>
                  </td>
                  <td className="py-2 pr-3">
                    {fmtYears(t.expMed)} <span className="text-xs text-muted">({fmtYears(t.expMin)}–{fmtYears(t.expMax)})</span>
                  </td>
                  <td className="py-2" title={t.need !== null ? `Total cash need in ${t.tier}: ${fmtLakh(t.need)} (investment + 3 months of fixed cost)` : undefined}>
                    {t.enough === null ? '—' : `${t.enough} of ${t.n}`} <span className="text-xs text-muted">vs {fmtLakh(t.need)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
