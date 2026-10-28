// Right-side slide-out drawer: the applicant's decision at a glance, without leaving the list or map.
// One-click actions sit at the bottom: copy the request / decision message, push this decision to HubSpot,
// or open the full applicant page.
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Send, X } from 'lucide-react';
import { useApp } from '../../state/AppState';
import { pushToHubSpot } from '../../data/hubspot';
import { Button, DecisionBadge, fmtKm } from '../components/ui';
import { CopyButton } from './parts';
import { outcomeSentence, primaryAction } from './model';

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-ink">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

export function ApplicantDrawer() {
  const { peekUid, peekApplicant, resultByUid, output, parse, openApplicant } = useApp();
  const r = peekUid ? resultByUid(peekUid) : undefined;
  const [push, setPush] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; text?: string }>({ state: 'idle' });

  useEffect(() => setPush({ state: 'idle' }), [peekUid]);
  useEffect(() => {
    if (!peekUid) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && peekApplicant(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peekUid, peekApplicant]);

  if (!r || !output) return null;
  const app = parse?.applications.find((a) => a.uid === r.uid);
  const slots = output.territories.find((t) => t.id === r.territoryId)?.openSlots ?? null;
  const action = primaryAction(r, app);
  const missing = r.asks.length > 0;

  const sendToHubSpot = async () => {
    setPush({ state: 'busy' });
    try {
      const res = await pushToHubSpot({ ...output, results: [r] });
      setPush({ state: 'ok', text: res.created ? 'Created in HubSpot' : 'Updated in HubSpot' });
    } catch (e) {
      setPush({ state: 'fail', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-[1200]" role="dialog" aria-modal="true" aria-label={`${r.appId} ${r.name}`}>
      <div className="absolute inset-0 animate-[fade_150ms_ease-out] bg-gray-900/30" onClick={() => peekApplicant(null)} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] animate-[slide-in_200ms_ease-out] flex-col bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-lg font-semibold text-ink">{r.name}</h2>
              <span className="tabular text-sm text-muted">{r.appId}</span>
              <DecisionBadge decision={r.decision} />
            </div>
            <p className="tabular mt-0.5 text-xs text-muted">
              {r.city} · pin {r.pin ?? 'unreadable'} · {r.territoryId ?? 'outside any territory'}
            </p>
          </div>
          <button onClick={() => peekApplicant(null)} className="rounded-md p-1.5 text-muted hover:bg-gray-100 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-[15px] leading-relaxed text-ink">{outcomeSentence(r, slots)}</p>
          <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line p-3 sm:grid-cols-4">
            {[
              ['Partner score', r.partnerScore.toFixed(1)],
              ['Place score', r.place.placeScore.toFixed(1)],
              ['Payback', r.economics.paybackMonths === null ? 'Never' : `${r.economics.paybackMonths.toFixed(1)} mo`],
              ['Cash gap', r.economics.capitalGapLakh > 0 ? `₹${r.economics.capitalGapLakh.toFixed(1)}L` : 'None'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-sm font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {r.redirect && (
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-ink">
              Offered pin {r.redirect.pin} {r.redirect.pinName} in {r.redirect.territoryId}, {fmtKm(r.redirect.km)} from the pin they asked for.
            </p>
          )}
          <List title="Why" items={r.reasons.slice(0, 5)} />
          <List title="Information to request" items={r.asks} />
          <List title="Conditions" items={r.conditions.map((c) => `${c.text} (${c.deadlineDays} days, ${c.owner})`)} />
          <List title="Next steps" items={r.nextSteps.slice(0, 4)} />
          <List title="What would change this" items={r.whatWouldChange.slice(0, 3)} />
        </div>

        <footer className="space-y-2 border-t border-line bg-slate-50 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <CopyButton text={action.message} label={missing ? 'Request missing info' : action.label} />
            <Button onClick={() => void sendToHubSpot()} disabled={push.state === 'busy'}>
              {push.state === 'ok' ? <Check size={15} /> : <Send size={15} />}
              {push.state === 'busy' ? 'Sending…' : push.state === 'ok' ? push.text : 'Send to HubSpot'}
            </Button>
            <Button variant="ghost" onClick={() => openApplicant(r.uid)}>
              Full page <ArrowUpRight size={15} />
            </Button>
          </div>
          <p className="text-xs text-muted">
            {push.state === 'fail' ? `HubSpot did not accept it: ${push.text}` : `${action.note} The message is copied to your clipboard to send.`}
          </p>
        </footer>
      </aside>
    </div>
  );
}
