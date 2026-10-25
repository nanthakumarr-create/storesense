// Side-by-side comparison of everyone who applied to one territory: experience, budget, scores, store economics.
import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Application, Result } from '../../types';
import { DecisionBadge, cx } from '../components/ui';
import { background, fmtNum, roiPct } from './helpers';

type Key = 'rank' | 'name' | 'exp' | 'invest' | 'partner' | 'place' | 'sales' | 'payback' | 'roi' | 'combined';

export interface Row {
  r: Result;
  app: Application | undefined;
  rank: number;
  won: boolean;
}

const COLS: { key: Key; label: string; title?: string; num: boolean }[] = [
  { key: 'rank', label: '#', num: true },
  { key: 'name', label: 'Applicant', num: false },
  { key: 'exp', label: 'Exp. (yrs)', title: 'Retail experience in years, from the application', num: true },
  { key: 'invest', label: 'Has / needs (₹L)', title: 'Investment capacity vs total cash needed (store investment + 3-month buffer, rulebook)', num: true },
  { key: 'partner', label: 'Partner', title: 'Partner score 0-100: experience, relevance, commitment, capital fit, involvement', num: true },
  { key: 'place', label: 'Place', title: 'Place score 0-100: unserved demand and store distance at their pin', num: true },
  { key: 'sales', label: 'Sales/mo (₹L)', title: 'Estimated monthly store sales (rulebook model on simulated demand)', num: true },
  { key: 'payback', label: 'Payback (mo)', title: 'Months to earn back the store investment; target 30', num: true },
  { key: 'roi', label: 'ROI/yr', title: 'Annual profit ÷ store investment', num: true },
  { key: 'combined', label: 'Combined', title: '0.5 × partner + 0.3 × place + 0.2 × readiness: decides the slot order', num: true },
];

const value = (row: Row, k: Key): number | string => {
  const { r, app } = row;
  switch (k) {
    case 'rank': return row.rank;
    case 'name': return r.name.toLowerCase();
    case 'exp': return app?.experienceYears ?? -1;
    case 'invest': return app?.investmentLakh ?? -1;
    case 'partner': return r.partnerScore;
    case 'place': return r.place.placeScore;
    case 'sales': return r.economics.monthlySalesLakh;
    case 'payback': return r.economics.paybackMonths ?? 9999;
    case 'roi': return roiPct(r) ?? -9999;
    case 'combined': return r.combinedScore;
  }
};
const ASC_FIRST: Key[] = ['rank', 'name', 'payback'];

function Budget({ row }: { row: Row }) {
  const has = row.app?.investmentLakh ?? null;
  const need = row.r.economics.totalCashNeedLakh;
  const gap = row.r.economics.capitalGapLakh;
  return (
    <span className="tabular">
      {fmtNum(has, 0)} / {fmtNum(need, 0)}
      <span className="block text-xs text-muted">{has === null ? 'not given' : gap > 0 ? `short ${fmtNum(gap, 1)}` : 'covered'}</span>
    </span>
  );
}

function Who({ row }: { row: Row }) {
  const { r, app } = row;
  return (
    <div className="min-w-0">
      <p className="truncate text-sm text-ink">
        <span className="font-medium">{r.name}</span> <span className="tabular text-muted">{r.appId}</span>
      </p>
      <p className="truncate text-xs text-muted">{background(app?.currentBusiness, app?.experienceYears ?? null)}</p>
      <p className="tabular truncate text-xs text-muted">
        Pin {r.pin ?? '—'} {r.place.pinName && r.place.pinName !== r.pin ? r.place.pinName : ''}
        {row.won && <span className="ml-1.5 font-medium text-brand-700">· {r.decision === 'Redirect' && r.redirect ? `Slot at ${r.redirect.pin}` : 'Won slot'}</span>}
        {r.partnership && <span className="ml-1.5">· Paired with {r.partnership.withAppId}</span>}
      </p>
    </div>
  );
}

export function ComparisonTable({ rows, slots, slotsUsed, onOpen }: { rows: Row[]; slots: number; slotsUsed: number; onOpen: (uid: string) => void }) {
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: 'rank', asc: true });
  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return (sort.asc ? c : -c) || a.rank - b.rank;
    });
    return out;
  }, [rows, sort]);
  const lastWinner = sort.key === 'rank' && sort.asc ? sorted.reduce((i, row, idx) => (row.won ? idx : i), -1) : -2;
  const toggle = (k: Key) => setSort((s) => (s.key === k ? { key: k, asc: !s.asc } : { key: k, asc: ASC_FIRST.includes(k) }));
  const divider = (
    <span>
      Slots end here · {slotsUsed} of {slots} slot{slots === 1 ? '' : 's'} filled above
    </span>
  );

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-slate-50 text-xs text-muted">
              {COLS.map((c) => (
                <th key={c.key} title={c.title} className={cx('whitespace-nowrap px-2 py-2 font-medium', c.num ? 'text-right' : 'text-left')}>
                  <button onClick={() => toggle(c.key)} className={cx('inline-flex items-center gap-1 hover:text-ink', sort.key === c.key && 'text-ink')}>
                    {c.label}
                    {sort.key === c.key && (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => {
              const { r } = row;
              const roi = roiPct(r);
              return (
                <Fragment key={r.uid}>
                  <tr onClick={() => onOpen(r.uid)} className={cx('cursor-pointer border-b border-line hover:bg-slate-50', row.won && 'bg-brand-50/40')}>
                    <td className="tabular px-2 py-2.5 text-right text-muted">{row.rank}</td>
                    <td className="max-w-[250px] px-2 py-2.5"><Who row={row} /></td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(row.app?.experienceYears ?? null)}</td>
                    <td className="px-2 py-2.5 text-right"><Budget row={row} /></td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(r.partnerScore)}</td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(r.place.placeScore)}</td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(r.economics.monthlySalesLakh, 1)}</td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(r.economics.paybackMonths, 1)}</td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtNum(roi, 0, '%')}</td>
                    <td className="tabular px-2 py-2.5 text-right font-medium">{fmtNum(r.combinedScore, 1)}</td>
                    <td className="px-2 py-2.5"><DecisionBadge decision={r.decision} /></td>
                  </tr>
                  {idx === lastWinner && idx < sorted.length - 1 && (
                    <tr>
                      <td colSpan={COLS.length + 1} className="border-b border-line bg-slate-50 px-3 py-1.5 text-center text-xs text-muted">{divider}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile and tablet: stacked rows with the four key numbers */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted lg:hidden">
        <label htmlFor="cmp-sort">Sort by</label>
        <select id="cmp-sort" value={sort.key} onChange={(e) => toggle(e.target.value as Key)} className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink">
          {COLS.map((c) => (
            <option key={c.key} value={c.key}>{c.key === 'rank' ? 'Slot order' : c.label}</option>
          ))}
        </select>
      </div>
      <ul className="divide-y divide-line lg:hidden">
        {sorted.map((row, idx) => {
          const { r } = row;
          return (
            <Fragment key={r.uid}>
              <li>
                <button onClick={() => onOpen(r.uid)} className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', row.won && 'bg-brand-50/40')}>
                  <div className="flex items-start gap-2">
                    <span className="tabular w-5 shrink-0 pt-0.5 text-xs text-muted">{row.rank}</span>
                    <div className="min-w-0 flex-1">
                      <Who row={row} />
                      <div className="mt-1.5"><DecisionBadge decision={r.decision} /></div>
                    </div>
                  </div>
                  <dl className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-7 text-xs sm:grid-cols-4">
                    <div><dt className="text-muted">Has / needs</dt><dd className="text-ink">₹{fmtNum(row.app?.investmentLakh ?? null)}L / ₹{fmtNum(r.economics.totalCashNeedLakh)}L</dd></div>
                    <div><dt className="text-muted">Partner score</dt><dd className="text-ink">{fmtNum(r.partnerScore)} / 100</dd></div>
                    <div><dt className="text-muted">Payback</dt><dd className="text-ink">{fmtNum(r.economics.paybackMonths, 1, ' mo')}</dd></div>
                    <div><dt className="text-muted">ROI a year</dt><dd className="text-ink">{fmtNum(roiPct(r), 0, '%')}</dd></div>
                  </dl>
                </button>
              </li>
              {idx === lastWinner && idx < sorted.length - 1 && <li className="bg-slate-50 px-4 py-1.5 text-center text-xs text-muted">{divider}</li>}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}
