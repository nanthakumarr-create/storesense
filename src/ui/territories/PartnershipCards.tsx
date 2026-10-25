// Operator + investor pairs suggested by the engine: one runs the store, the other funds it.
import type { Partnership } from '../../types';
import { Card } from '../components/ui';
import { fmtNum } from './helpers';

function Person({ role, name, appId, uid, onOpen }: { role: string; name: string; appId: string; uid: string; onOpen: (uid: string) => void }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{role}</p>
      <button onClick={() => onOpen(uid)} className="max-w-full truncate text-left text-sm font-medium text-brand-700 hover:underline">
        {name} <span className="tabular font-normal text-muted">{appId}</span>
      </button>
    </div>
  );
}

export function PartnershipCards({ pairs, onOpen }: { pairs: Partnership[]; onOpen: (uid: string) => void }) {
  if (!pairs.length) {
    return (
      <Card className="px-4 py-5 text-sm text-muted">
        No partnership suggested here. A pair is suggested only when one applicant has retail experience but not enough money, and another in the same territory has the money but little or no experience.
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {pairs.map((p) => (
        <Card key={p.id} className="flex flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              <Person role="Runs the store (operator)" name={p.operatorName} appId={p.operatorAppId} uid={p.operatorUid} onOpen={onOpen} />
              <Person role="Funds the store (investor)" name={p.investorName} appId={p.investorAppId} uid={p.investorUid} onOpen={onOpen} />
            </div>
            <span className={p.status === 'allocated' ? 'rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700' : 'rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'}>
              {p.status === 'allocated' ? 'Won a slot' : 'Suggested'}
            </span>
          </div>
          <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Joint money / need</dt><dd>₹{fmtNum(p.combinedInvestmentLakh)}L / ₹{fmtNum(p.totalCashNeedLakh)}L</dd></div>
            <div><dt className="text-xs text-muted">Joint partner score</dt><dd>{fmtNum(p.partnerScore)} / 100</dd></div>
            <div><dt className="text-xs text-muted">Payback</dt><dd>{fmtNum(p.paybackMonths, 1, ' mo')}</dd></div>
            <div><dt className="text-xs text-muted">Rank if paired</dt><dd>{p.rankInTerritory ? `#${p.rankInTerritory}` : '—'} <span className="text-xs text-muted">({fmtNum(p.combinedScore, 1)})</span></dd></div>
          </dl>
          <div className="border-t border-line px-4 py-3">
            <p className="text-xs text-muted">Store at pin {p.pin} {p.pinName}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-slate-700">
              {p.covers.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
          {p.outcome && <p className="mt-auto border-t border-line bg-slate-50 px-4 py-2.5 text-sm text-ink">{p.outcome}</p>}
        </Card>
      ))}
    </div>
  );
}
