// Applicant page (#/applicant/APP-012): who they are, why, where, money, how the score was built,
// how they compare in their territory, the decision and the next steps. Everything comes from engine data.
import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Application, Result } from '../../types';
import { Button, DecisionBadge, EmptyState, cx, fmtDate } from '../components/ui';
import { Collapsible, CopyButton } from '../applicant/parts';
import { outcomeSentence, primaryAction } from '../applicant/model';
import {
  CompareSection, MoneySection, PartnershipSection, PlanSection, ReasonsSection, ScoreSection, WhereSection, WhoSection, WhySection,
} from '../applicant/sections';

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  return String(v);
}

export function ApplicantPage() {
  const { output, parse, selectedUid, resultByUid, setPage, openApplicant, openTerritory, openMapAt, setDraftQuestion } = useApp();
  const r = selectedUid ? resultByUid(selectedUid) : undefined;

  const appByUid = useMemo(() => new Map<string, Application>(parse?.applications.map((a) => [a.uid, a]) ?? []), [parse]);
  const peers = useMemo<Result[]>(() => {
    if (!output || !r?.territoryId) return [];
    return output.results
      .filter((x) => x.territoryId === r.territoryId)
      .sort((a, b) => b.combinedScore - a.combinedScore || a.appId.localeCompare(b.appId, undefined, { numeric: true }));
  }, [output, r?.territoryId]);

  if (!output || !r) {
    return (
      <div className="rounded-xl border border-line bg-white">
        <EmptyState
          title={selectedUid ? `No application ${selectedUid} in this file` : 'No applicant selected'}
          body="It may have been in a different upload. Pick an applicant from the list."
          action={<Button variant="primary" onClick={() => setPage('territories')}>Back to applications</Button>}
        />
      </div>
    );
  }

  const app = appByUid.get(r.uid);
  const terr = parse?.territories.find((t) => t.id === r.territoryId);
  const status = output.territories.find((t) => t.id === r.territoryId);
  const pair = r.partnership ? (output.partnerships ?? []).find((p) => p.id === r.partnership!.id) : undefined;
  const idx = peers.findIndex((p) => p.uid === r.uid);
  const prev = idx > 0 ? peers[idx - 1] : null;
  const next = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null;
  const action = primaryAction(r, app);
  const updates = app?.updates ?? [];

  const ask = () => {
    setDraftQuestion(`Why is ${r.appId} ${r.decision === 'Approve' ? 'approved' : r.decision === 'Approve with conditions' ? 'approved with conditions' : r.decision === 'Hold' ? 'on hold' : r.decision === 'Decline' ? 'declined' : r.decision === 'Waitlist' ? 'waitlisted' : 'redirected'}?`);
    setPage('ask');
  };

  return (
    <div className="mx-auto max-w-[1040px] space-y-4 pb-10">
      {/* Breadcrumb + prev/next within the territory */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
          <button className="hover:text-ink hover:underline" onClick={() => setPage('territories')}>
            Applications
          </button>
          <span aria-hidden>›</span>
          {r.territoryId ? (
            <button className="hover:text-ink hover:underline" onClick={() => openTerritory(r.territoryId)}>
              {r.territoryId}
            </button>
          ) : (
            <span>No territory</span>
          )}
          <span aria-hidden>›</span>
          <span className="truncate font-medium text-ink">{r.appId}</span>
        </nav>
        {peers.length > 1 && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={!prev} onClick={() => prev && openApplicant(prev.uid)} aria-label="Previous applicant in territory">
              <ChevronLeft size={14} /> {prev ? prev.appId : 'Prev'}
            </Button>
            <span className="tabular text-xs text-muted">
              {idx + 1} / {peers.length}
            </span>
            <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && openApplicant(next.uid)} aria-label="Next applicant in territory">
              {next ? next.appId : 'Next'} <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>

      {/* 1. Decision banner */}
      <section className="rounded-xl border border-line bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-ink">{r.name}</h1>
              <span className="tabular text-sm text-muted">{r.appId}</span>
              <DecisionBadge decision={r.decision} size="md" />
            </div>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink">{outcomeSentence(r, terr?.openSlots ?? status?.openSlots ?? null)}</p>
            <dl className="tabular mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {[
                ['Combined score', r.combinedScore.toFixed(2)],
                ['Slot rank', r.rankInTerritory && r.territoryId ? `${r.rankInTerritory} in ${r.territoryId}` : '—'],
                ['Payback', r.economics.paybackMonths === null ? 'Never' : `${r.economics.paybackMonths.toFixed(1)} mo`],
                ['Cash gap', r.economics.capitalGapLakh > 0 ? `₹${r.economics.capitalGapLakh.toFixed(1)} L short` : 'None'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-base font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 md:w-60">
            <CopyButton text={action.message} label={action.label} />
            <Button variant="ghost" onClick={ask}>
              <MessageSquare size={15} /> Ask about this applicant
            </Button>
            <p className="text-xs text-muted">{action.note}</p>
          </div>
        </div>
      </section>

      {/* 2. Who / why */}
      <div className="grid gap-4 md:grid-cols-2">
        <WhoSection r={r} app={app} />
        <WhySection app={app} />
      </div>

      {/* 8. Partnership is shown early when it exists: it changes how the rest reads */}
      <PartnershipSection r={r} pair={pair} onOpen={(uid) => openApplicant(uid)} />

      {/* 3-7 */}
      <WhereSection r={r} terr={terr} status={status} onMap={(pin) => openMapAt(pin)} />
      <MoneySection r={r} app={app} />
      <ScoreSection r={r} app={app} />
      <CompareSection r={r} peers={peers} appByUid={appByUid} status={status} terr={terr} onOpen={(uid) => openApplicant(uid)} />
      <ReasonsSection r={r} />

      {/* 9 */}
      <PlanSection r={r} />

      {/* Collapsed details */}
      <Collapsible title="Data checks" count={r.flags.length}>
        {r.flags.length ? (
          <ul className="divide-y divide-line">
            {r.flags.map((f, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-sm text-ink">{f.message}</span>
                <span className={cx('shrink-0 text-xs', f.severity === 'block' ? 'text-decline' : 'text-muted')}>
                  {f.severity === 'block' ? 'Blocks the decision' : f.severity === 'ask' ? 'Ask the applicant' : 'For information'} · {f.code}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Every field passed the checks (allowed values, pin matches city, space details consistent).</p>
        )}
      </Collapsible>
      <Collapsible title="Change history" count={updates.length}>
        {updates.length ? (
          <ul className="divide-y divide-line">
            {updates.map((u, i) => (
              <li key={i} className="py-2 text-sm">
                <p className="text-ink">
                  <span className="font-medium">{u.field}</span>: {fmtVal(u.from)} → {fmtVal(u.to)}
                </p>
                <p className="text-xs text-muted">
                  {fmtDate(u.at.slice(0, 10))} · from “{u.source}”
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No changes since upload (row {app?.rowNumber ?? '—'} of {parse?.source.fileName ?? 'the file'}). New information given in Ask is recorded here.</p>
        )}
      </Collapsible>
    </div>
  );
}
