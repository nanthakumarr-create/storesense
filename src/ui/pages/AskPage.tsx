// Ask StoreSense: plain-language questions about decisions, and new information that re-runs them.
// Template mode: answers are built from engine results (src/chat/answer.ts); an LLM may only rephrase later.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowRight, Bot, Cpu, History, Info, Lightbulb, MessageSquare, RotateCcw, Send, User } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Decision } from '../../types';
import { Button, Card, CardHeader, DECISION_STYLE, DecisionBadge, EmptyState, Pill, cx } from '../components/ui';
import { parseIntent, resolveUpdate, type UpdateIntent } from '../../chat/intents';
import {
  EXAMPLES,
  buildAnswer,
  buildUpdateReply,
  findByAppId,
  noChangeUpdateReply,
  unknownIdReply,
  withdrawReply,
  type ApplicantRef,
  type CompareTable,
  type Reply,
  type ReplySection,
  type UpdateDiff,
} from '../../chat/answer';
import { LLM_ENABLED, phraseWithLLM } from '../../chat/llm';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: Reply;
  at: string;
}

// Kept at module level so the conversation survives switching pages (the page unmounts).
let savedMessages: Msg[] = [];
let nextId = 1;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- small pieces

function ApplicantChip({ r, onOpen }: { r: ApplicantRef; onOpen: (uid: string) => void }) {
  return (
    <button
      onClick={() => onOpen(r.uid)}
      title={`${r.appId} · ${r.name} · ${r.decision}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink transition-colors hover:border-brand-600 hover:bg-brand-50"
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DECISION_STYLE[r.decision].dot)} />
      <span className="tabular font-semibold">{r.appId}</span>
      <span className="truncate text-muted">{r.name}</span>
    </button>
  );
}

function ChipList({ refs, onOpen }: { refs: ApplicantRef[]; onOpen: (uid: string) => void }) {
  const [all, setAll] = useState(false);
  const LIMIT = 18;
  const shown = all ? refs : refs.slice(0, LIMIT);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <ApplicantChip key={r.uid} r={r} onOpen={onOpen} />
      ))}
      {refs.length > LIMIT && (
        <button onClick={() => setAll(!all)} className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
          {all ? 'Show fewer' : `+${refs.length - LIMIT} more`}
        </button>
      )}
    </div>
  );
}

function Section({ s }: { s: ReplySection }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{s.title}</p>
      <ul
        className={cx(
          'space-y-1 border-l-2 pl-3 text-sm',
          s.tone === 'warn' ? 'border-amber-300' : s.tone === 'good' ? 'border-green-300' : 'border-slate-200',
        )}
      >
        {s.bullets.map((b, i) => (
          <li key={i} className="text-ink/90">
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FocusCard({ f, onOpen }: { f: NonNullable<Reply['focus']>; onOpen: (uid: string) => void }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular text-sm font-semibold text-ink">{f.appId}</span>
          <span className="truncate text-sm text-muted">{f.name}</span>
        </div>
        <DecisionBadge decision={f.decision} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {f.numbers.map((n) => (
          <div key={n.label} className="min-w-0">
            <dt className="text-[11px] text-muted">{n.label}</dt>
            <dd className="tabular truncate text-sm font-medium text-ink">{n.value}</dd>
          </div>
        ))}
      </dl>
      <button onClick={() => onOpen(f.uid)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        Open full record <ArrowRight size={12} />
      </button>
    </div>
  );
}

function CompareView({ c, onOpen }: { c: CompareTable; onOpen: (uid: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-xs sm:text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            <th className="w-[34%] px-2.5 py-2 font-medium text-muted"></th>
            {[c.a, c.b].map((r) => (
              <th key={r.uid} className="px-2.5 py-2">
                <button onClick={() => onOpen(r.uid)} className="tabular font-semibold text-brand-700 hover:underline">
                  {r.appId}
                </button>
                <p className="truncate text-[11px] font-normal text-muted">{r.name}</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {c.rows.map((row) => (
            <tr key={row.label}>
              <td className="px-2.5 py-1.5 text-muted">{row.label}</td>
              {(['a', 'b'] as const).map((k) => (
                <td key={k} className={cx('tabular break-words px-2.5 py-1.5', row.better === k ? 'font-semibold text-approve' : 'text-ink')}>
                  {row.label === 'Decision' ? <DecisionBadge decision={row[k] as Decision} /> : row[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffView({ d, onOpen }: { d: UpdateDiff; onOpen: (uid: string) => void }) {
  const changedMetrics = d.metrics.filter((m) => m.changed);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">What I understood</p>
        {d.understood.length ? (
          <ul className="space-y-1 text-sm">
            {d.understood.map((u) => (
              <li key={u.label} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-muted">{u.label}:</span>
                {u.from && <span className="text-muted line-through decoration-slate-300">{u.from}</span>}
                {u.from && <ArrowRight size={12} className="self-center text-muted" />}
                <span className="font-medium text-ink">{u.to}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No field changes.</p>
        )}
        {d.assumptions.length > 0 && (
          <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-waitlist">
            {d.assumptions.map((a, i) => (
              <p key={i} className="flex gap-1.5">
                <Info size={13} className="mt-px shrink-0" /> {a}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-slate-50/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Before</p>
          <div className="mt-1.5">
            <DecisionBadge decision={d.before.decision} />
          </div>
          <p className="mt-2 text-xs text-muted">{d.before.headline}</p>
        </div>
        <div className="flex items-center justify-center text-muted">
          <ArrowRight size={18} className="hidden sm:block" />
          <ArrowDown size={18} className="sm:hidden" />
        </div>
        <div className={cx('rounded-lg border p-3', d.decisionChanged ? 'border-brand-600 bg-brand-50/50' : 'border-line bg-slate-50/60')}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">After {d.decisionChanged ? '' : '(unchanged)'}</p>
          <div className="mt-1.5">
            <DecisionBadge decision={d.after.decision} />
          </div>
          <p className="mt-2 text-xs text-ink">{d.after.headline}</p>
        </div>
      </div>

      {changedMetrics.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Number</th>
                <th className="px-2.5 py-1.5 font-medium">Before</th>
                <th className="px-2.5 py-1.5 font-medium">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {changedMetrics.map((m) => (
                <tr key={m.label}>
                  <td className="px-2.5 py-1.5 text-muted">{m.label}</td>
                  <td className="tabular px-2.5 py-1.5 text-muted">{m.before}</td>
                  <td className="tabular px-2.5 py-1.5 font-medium text-ink">{m.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Other applicants affected</p>
        {d.ripple.length ? (
          <ul className="space-y-1.5">
            {d.ripple.map((c) => (
              <li key={c.uid} className="flex flex-wrap items-center gap-1.5 text-xs">
                <ApplicantChip r={{ uid: c.uid, appId: c.appId, name: c.name, decision: c.after }} onOpen={onOpen} />
                <DecisionBadge decision={c.before} />
                <ArrowRight size={12} className="text-muted" />
                <DecisionBadge decision={c.after} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">None. No other decision moved when the rules re-ran.</p>
        )}
      </div>
      <button onClick={() => onOpen(d.uid)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        Open {d.appId} full record <ArrowRight size={12} />
      </button>
    </div>
  );
}

function AssistantBody({ reply, onOpen, onAsk }: { reply: Reply; onOpen: (uid: string) => void; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <p className={cx('text-sm leading-relaxed', reply.tone === 'error' ? 'text-decline' : 'text-ink')}>
        {reply.tone === 'warn' && <AlertTriangle size={14} className="mr-1.5 inline -translate-y-px text-waitlist" />}
        {reply.text}
      </p>
      {reply.diff && <DiffView d={reply.diff} onOpen={onOpen} />}
      {reply.focus && <FocusCard f={reply.focus} onOpen={onOpen} />}
      {reply.compare && <CompareView c={reply.compare} onOpen={onOpen} />}
      {reply.bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink/90 marker:text-slate-300">
          {reply.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {reply.sections?.map((s) => (
        <Section key={s.title} s={s} />
      ))}
      {reply.cards && reply.cards.length > 0 && !reply.compare && !(reply.focus && reply.cards.length === 1) && <ChipList refs={reply.cards} onOpen={onOpen} />}
      {reply.followUps && reply.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
          {reply.followUps.map((q) => (
            <button key={q} onClick={() => onAsk(q)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-brand-50 hover:text-brand-700">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({ m, onOpen, onAsk }: { m: Msg; onOpen: (uid: string) => void; onAsk: (q: string) => void }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-700 px-3.5 py-2 text-sm text-white">
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          <p className="mt-0.5 text-right text-[10px] text-white/60">{timeOf(m.at)}</p>
        </div>
        <span className="mt-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 sm:flex">
          <User size={14} />
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="mt-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 sm:flex">
        <Bot size={15} />
      </span>
      <div className="min-w-0 max-w-full flex-1 rounded-2xl rounded-tl-sm border border-line bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-[92%] sm:flex-none">
        {m.reply ? <AssistantBody reply={m.reply} onOpen={onOpen} onAsk={onAsk} /> : <p className="text-sm">{m.text}</p>}
        <p className="mt-2 text-[10px] text-muted">
          {timeOf(m.at)} · from the rules engine{m.reply?.diff ? ' · decisions re-run' : ''}
        </p>
      </div>
    </div>
  );
}

function SideCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon}{title}</span>} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------- page

export function AskPage() {
  const { output, parse, updateApplication, resetUpdates, openApplicant, activity } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(() => savedMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    savedMessages = msgs;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const knownIds = useMemo(() => output?.results.map((r) => r.appId) ?? [], [output]);
  const names = useMemo(() => output?.results.map((r) => ({ id: r.appId, name: r.name })) ?? [], [output]);
  const updated = useMemo(() => parse?.applications.filter((a) => a.updates && a.updates.length > 0) ?? [], [parse]);
  const hasResults = !!output && output.results.length > 0;

  const applyUpdate = (intent: UpdateIntent, q: string): Reply => {
    if (!output || !parse || !output.results.length) return buildAnswer(intent, output, parse);
    const rs = findByAppId(output, intent.appId);
    if (!rs.length) return unknownIdReply(output, intent.appId);
    const r = rs[0];
    if (intent.withdraw) {
      updateApplication(r.uid, {}, q);
      return withdrawReply(output, r);
    }
    const app = parse.applications.find((a) => a.uid === r.uid);
    if (!app) return unknownIdReply(output, intent.appId);
    const resolved = resolveUpdate(intent, app);
    if (!resolved.changes.length) return noChangeUpdateReply(r, resolved.assumptions);
    const outcome = updateApplication(r.uid, resolved.patch, q);
    return buildUpdateReply(r.appId, resolved, outcome);
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const at = new Date().toISOString();
    setMsgs((m) => [...m, { id: nextId++, role: 'user', text: q, at }]);
    setBusy(true);
    let reply: Reply;
    try {
      const intent = parseIntent(q, knownIds, names);
      reply = intent.kind === 'update' ? applyUpdate(intent, q) : buildAnswer(intent, output, parse);
    } catch (e) {
      reply = {
        text: 'Something went wrong while reading that question. The decisions are unchanged; try rephrasing with an application ID.',
        bullets: [e instanceof Error ? e.message : String(e)],
        tone: 'error',
      };
    }
    let phrased = reply.text;
    try {
      phrased = await phraseWithLLM(reply, q);
    } catch {
      phrased = reply.text; // the chat must never break
    }
    setMsgs((m) => [...m, { id: nextId++, role: 'assistant', text: phrased, reply: { ...reply, text: phrased }, at: new Date().toISOString() }]);
    setBusy(false);
    inputRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const clearChat = () => {
    setMsgs([]);
  };

  const recentUpdates = activity.filter((a) => a.changes.length > 0 || /:/.test(a.text)).slice(0, 6);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Ask StoreSense</h1>
          <p className="mt-1 text-sm text-muted">Ask why a decision was made, or give new information about an applicant. Updates re-run every decision and show what moved.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700" title="No AI decides anything. Replies are built from the engine's reasons and numbers.">
            <Cpu size={12} />
            {LLM_ENABLED ? 'AI phrasing on · facts from the rules engine' : 'Template mode: answers come from the rules engine'}
          </span>
          <Button size="sm" onClick={resetUpdates} disabled={!updated.length} title="Undo every chat update and go back to the uploaded file">
            <RotateCcw size={13} /> Reset updates{updated.length ? ` (${updated.length})` : ''}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex h-[calc(100dvh-230px)] min-h-[480px] flex-col overflow-hidden lg:h-[calc(100vh-190px)]">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              <MessageSquare size={16} className="shrink-0 text-brand-700" />
              <span className="truncate">Conversation</span>
              {hasResults && <span className="tabular hidden text-xs font-normal text-muted sm:inline">· {output!.results.length} applications loaded</span>}
            </div>
            {msgs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearChat}>
                Clear chat
              </Button>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-canvas/60 px-3 py-4 sm:px-4">
            {!hasResults && (
              <EmptyState
                icon={<Bot size={36} />}
                title="No decisions to ask about yet"
                body="The rules engine has not produced results for this file. Upload an Applications + Territories file on the Data sources page, or wait for the sample to finish loading."
              />
            )}
            {hasResults && msgs.length === 0 && (
              <div className="mx-auto max-w-xl py-6 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Bot size={22} />
                </div>
                <p className="mt-3 text-sm font-semibold text-ink">Ask about any applicant, territory or gap</p>
                <p className="mt-1 text-sm text-muted">
                  Every answer quotes the engine's reasons and numbers. Tell it new information ("found a ground-floor space", "got a loan of 10 lakh") and it re-runs the rules and shows before → after.
                </p>
                <div className="mt-4 grid gap-2 text-left sm:grid-cols-2">
                  {EXAMPLES.map((q, i) => (
                    <button
                      key={q}
                      onClick={() => void ask(q)}
                      className={cx(
                        'rounded-lg border px-3 py-2 text-sm transition-colors hover:border-brand-600 hover:bg-brand-50',
                        i < 2 ? 'border-brand-100 bg-white font-medium text-brand-900' : 'border-line bg-white text-ink',
                      )}
                    >
                      {i < 2 && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-brand-700">From the brief</span>}
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <Bubble key={m.id} m={m} onOpen={openApplicant} onAsk={(q) => void ask(q)} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 pl-1 text-xs text-muted">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </span>
                Re-running the rules…
              </div>
            )}
          </div>

          <div className="border-t border-line bg-white px-3 py-2.5 sm:px-4">
            {msgs.length > 0 && (
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    disabled={busy || !hasResults}
                    className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={hasResults ? 'e.g. Why is APP-007 on hold?  or  APP-012 found a 500 sq ft ground-floor shop' : 'Load a file first'}
                disabled={!hasResults}
                aria-label="Ask StoreSense"
                className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-50"
              />
              <Button type="submit" variant="primary" disabled={!input.trim() || busy || !hasResults} aria-label="Send">
                <Send size={15} />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </div>
        </Card>

        <div className="space-y-4">
          <SideCard title="How answers work" icon={<Lightbulb size={15} className="text-brand-700" />}>
            <ul className="space-y-2 text-xs text-muted">
              <li>
                <span className="font-medium text-ink">Rules decide, not AI.</span> Replies quote the engine's reasons, scores and payback for that applicant.
              </li>
              <li>
                <span className="font-medium text-ink">New information re-runs everything.</span> Slots are re-allocated, so other applicants in the same territory can move too.
              </li>
              <li>
                <span className="font-medium text-ink">Guesses are shown.</span> If a message leaves something out (e.g. space size), the reply lists the assumption and what to ask for.
              </li>
            </ul>
          </SideCard>

          <SideCard title="Updated this session" icon={<History size={15} className="text-brand-700" />}>
            {updated.length === 0 ? (
              <p className="text-xs text-muted">No chat updates yet. Decisions match the uploaded file.</p>
            ) : (
              <ul className="space-y-2">
                {updated.map((a) => {
                  const r = output?.results.find((x) => x.uid === a.uid);
                  return (
                    <li key={a.uid} className="space-y-1">
                      {r ? <ApplicantChip r={{ uid: r.uid, appId: r.appId, name: r.name, decision: r.decision }} onOpen={openApplicant} /> : <span className="text-xs font-semibold">{a.id}</span>}
                      <p className="text-[11px] text-muted">
                        {a.updates!.length} field change{a.updates!.length === 1 ? '' : 's'}: {[...new Set(a.updates!.map((u) => u.field))].join(', ')}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {recentUpdates.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Activity</p>
                <ul className="space-y-1.5">
                  {recentUpdates.map((a, i) => (
                    <li key={i} className="text-[11px] leading-snug text-muted">
                      <span className="tabular text-slate-400">{timeOf(a.at)}</span> {a.text}
                      {a.changes.length > 0 && (
                        <span className="ml-1">
                          <Pill tone="brand">
                            {a.changes.length} decision{a.changes.length === 1 ? '' : 's'} moved
                          </Pill>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SideCard>
        </div>
      </div>
    </div>
  );
}
