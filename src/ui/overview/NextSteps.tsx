// "Your next steps": a short, ordered action list built from the engine output. Each item says what to do,
// how many applicants it touches, and opens the right place. Items with nothing to do are hidden.
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { EngineOutput, Result } from '../../types';
import { Button, cx, fmtInt, fmtKm, fmtLakh } from '../components/ui';

export interface StepItem {
  key: string;
  count: number;
  title: string; // verb first
  detail: string;
  action: { label: string; run: () => void };
  rows: { id: string; label: ReactNode; meta: string; open: () => void }[];
}

interface Handlers {
  openApplicant: (uid: string) => void;
  openTerritory: (id: string) => void;
  openApplications: () => void;
  openCrm: () => void;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const byAppId = (a: Result, b: Result) => a.appId.localeCompare(b.appId, undefined, { numeric: true });

export function buildNextSteps(output: EngineOutput, h: Handlers): StepItem[] {
  const items: StepItem[] = [];
  const rs = output.results;

  // 1. Holds: information only the operator can get.
  const holds = rs.filter((r) => r.decision === 'Hold').sort(byAppId);
  if (holds.length) {
    items.push({
      key: 'hold',
      count: holds.length,
      title: `Request missing information from ${holds.length} ${plural(holds.length, 'applicant', 'applicants')}`,
      detail: 'They are on hold until they reply. Each one has the exact question to send.',
      action: { label: `Start with ${holds[0].appId}`, run: () => h.openApplicant(holds[0].uid) },
      rows: holds.map((r) => ({
        id: r.uid,
        label: (
          <>
            <span className="tabular font-medium">{r.appId}</span> {r.name}
          </>
        ),
        meta: r.asks[0] ?? r.headline,
        open: () => h.openApplicant(r.uid),
      })),
    });
  }

  // 2. Conditional approvals: each has a named condition and a deadline.
  const cond = rs.filter((r) => r.decision === 'Approve with conditions').sort(byAppId);
  if (cond.length) {
    const deadlines = cond.flatMap((r) => r.conditions.map((c) => c.deadlineDays));
    const soonest = deadlines.length ? Math.min(...deadlines) : null;
    items.push({
      key: 'conditional',
      count: cond.length,
      title: `Confirm ${cond.length} conditional ${plural(cond.length, 'approval', 'approvals')}`,
      detail: `Each has a condition and a deadline${soonest !== null ? `; the earliest is due in ${soonest} days` : ''}.`,
      action: { label: 'Review', run: () => h.openApplicant(cond[0].uid) },
      rows: cond.map((r) => ({
        id: r.uid,
        label: (
          <>
            <span className="tabular font-medium">{r.appId}</span> {r.name}
          </>
        ),
        meta: r.conditions.length ? r.conditions.map((c) => `${c.text} (${c.deadlineDays} days)`).join('; ') : r.headline,
        open: () => h.openApplicant(r.uid),
      })),
    });
  }

  // 3. Redirects: good partners whose pin is taken; offer the nearest open pin.
  const redir = rs.filter((r) => r.decision === 'Redirect').sort(byAppId);
  if (redir.length) {
    const kms = redir.map((r) => r.redirect?.km).filter((k): k is number => typeof k === 'number');
    const range = kms.length ? ` ${fmtKm(Math.min(...kms))} to ${fmtKm(Math.max(...kms))} from the pin they asked for.` : '';
    items.push({
      key: 'redirect',
      count: redir.length,
      title: `Offer ${redir.length} ${plural(redir.length, 'applicant', 'applicants')} a nearby open pin`,
      detail: `Their pin is taken or too close to a store.${range}`,
      action: { label: 'Review', run: () => h.openApplicant(redir[0].uid) },
      rows: redir.map((r) => ({
        id: r.uid,
        label: (
          <>
            <span className="tabular font-medium">{r.appId}</span> {r.name}
          </>
        ),
        meta: r.redirect ? `${r.pin ?? '—'} → ${r.redirect.pin} ${r.redirect.pinName} (${fmtKm(r.redirect.km)} away)` : r.headline,
        open: () => h.openApplicant(r.uid),
      })),
    });
  }

  // 4. Suggested partnerships: investor with money + operator with experience in the same territory.
  const pairs = (output.partnerships ?? []).filter((p) => p.status === 'suggested');
  if (pairs.length) {
    items.push({
      key: 'pairs',
      count: pairs.length,
      title: `Review ${pairs.length} suggested ${plural(pairs.length, 'partnership', 'partnerships')}`,
      detail: 'Each pairs an experienced retailer who is short of money with an investor in the same territory.',
      action: { label: 'Review', run: () => h.openApplicant(pairs[0].operatorUid) },
      rows: pairs.map((p) => ({
        id: p.id,
        label: (
          <>
            <span className="tabular font-medium">{p.operatorAppId}</span> {p.operatorName} <span className="text-muted">+</span>{' '}
            <span className="tabular font-medium">{p.investorAppId}</span> {p.investorName}
          </>
        ),
        meta: [
          p.territoryId,
          `${fmtLakh(p.combinedInvestmentLakh)} together vs ${fmtLakh(p.totalCashNeedLakh)} needed`,
          p.paybackMonths !== null ? `payback ${Math.round(p.paybackMonths)} months` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        open: () => h.openApplicant(p.operatorUid),
      })),
    });
  }

  // 5. Territories where demand is high and strong partners are waiting.
  // A territory with 0 open slots cannot use a higher priority, so it is worded as "add a slot" instead.
  const raise = output.territories.filter((t) => t.suggestRaisePriority);
  if (raise.length) {
    const noSlots = raise.filter((t) => t.openSlots === 0);
    const withSlots = raise.filter((t) => t.openSlots > 0);
    const ids = (ts: typeof raise) => ts.map((t) => t.id).join(', ');
    const title =
      withSlots.length && noSlots.length
        ? `Look at ${ids(withSlots)} (priority could be raised) and ${ids(noSlots)} (no open slots; consider adding one)`
        : noSlots.length
          ? `Consider adding a slot in ${ids(noSlots)}: no open slots, but strong applicants are waiting`
          : `Look at ${ids(withSlots)}: priority could be raised`;
    items.push({
      key: 'raise',
      count: raise.length,
      title,
      detail: noSlots.length
        ? 'Demand is high and strong applicants are waiting. Where the brand planned 0 slots, nobody can be approved until the expansion head adds one.'
        : 'Demand is high and strong applicants are waiting for a slot.',
      action: { label: `Open ${raise[0].id}`, run: () => h.openTerritory(raise[0].id) },
      rows: raise.map((t) => ({
        id: t.id,
        label: (
          <>
            <span className="tabular font-medium">{t.id}</span> {t.city}
          </>
        ),
        meta: t.openSlots === 0
          ? `${t.priority} priority · 0 slots planned (full, no winner needed) · ${t.contenders.length} waiting`
          : `${t.priority} priority · ${t.filled.length} of ${t.openSlots} slots filled · ${t.contenders.length} waiting`,
        open: () => h.openTerritory(t.id),
      })),
    });
  }

  // 6. Push decisions to the CRM (always last).
  const decided = output.summary.total - output.summary.byDecision.Hold;
  if (decided > 0) {
    items.push({
      key: 'crm',
      count: decided,
      title: 'Push decisions to HubSpot',
      detail: `Sends the ${fmtInt(decided)} final decisions with reasons. Holds stay open until they reply.`,
      action: { label: 'Open Data & CRM', run: h.openCrm },
      rows: [],
    });
  }

  // Max 6 items; the CRM step is always kept as the last one.
  if (items.length > 6) {
    const crm = items.find((i) => i.key === 'crm');
    const rest = items.filter((i) => i.key !== 'crm').slice(0, crm ? 5 : 6);
    return crm ? [...rest, crm] : rest;
  }
  return items;
}

function StepRow({ item, index, primary }: { item: StepItem; index: number; primary: boolean }) {
  const [open, setOpen] = useState(false);
  const canExpand = item.rows.length > 0;
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="tabular mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">{index + 1}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{item.title}</p>
            <p className="mt-0.5 text-sm text-muted">{item.detail}</p>
            {canExpand && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                aria-expanded={open}
              >
                {open ? 'Hide' : 'Show'} {item.rows.length === 1 ? 'the 1 item' : `all ${item.rows.length}`}
                <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
              </button>
            )}
          </div>
          <div className="shrink-0">
            <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={item.action.run}>
              {item.action.label}
            </Button>
          </div>
        </div>
      </div>
      {open && canExpand && (
        <ul className="mt-3 divide-y divide-line ml-9 rounded-lg border border-line">
          {item.rows.map((r) => (
            <li key={r.id}>
              <button onClick={r.open} className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-gray-50">
                <span className="text-sm text-ink">{r.label}</span>
                <span className="text-xs leading-relaxed text-muted">{r.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function NextSteps({ items }: { items: StepItem[] }) {
  if (!items.length) {
    return <p className="px-5 py-8 text-center text-sm text-muted">Nothing needs your attention. Every applicant has a final decision.</p>;
  }
  return (
    <ol className="divide-y divide-line">
      {items.map((it, i) => (
        <StepRow key={it.key} item={it} index={i} primary={i === 0} />
      ))}
    </ol>
  );
}
