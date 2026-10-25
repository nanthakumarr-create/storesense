// Ask StoreSense: plain-language questions about decisions, and new information that re-runs them.
// Template mode: answers are built from engine results (src/chat/answer.ts); an LLM may only rephrase later.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, RotateCcw, Send } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Decision } from '../../types';
import { Button, Card, CardHeader, DECISION_STYLE, DecisionBadge, EmptyState, PageHeader, cx } from '../components/ui';
import { parseIntent, resolveUpdate, type UpdateIntent } from '../../chat/intents';
import {
  buildAnswer,
  buildUpdateReply,
  findByAppId,
  noChangeUpdateReply,
  unknownIdReply,
  withdrawReply,
  type ApplicantRef,
  type CompareTable,
  type Reply,
  type ReplyLink,
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

/** Starter questions, grouped by what the operator wants to do. The first two are the judges' examples. */
const STARTERS: { title: string; items: string[] }[] = [
  { title: 'Ask why', items: ['Why is APP-007 on hold?', 'Compare APP-003 and APP-045', 'What happened in TER-02?'] },
  { title: 'Give new information', items: ['APP-012 has now found a ground-floor space', 'APP-038 got a loan of 10 lakh', 'APP-015 hired a manager with 5 years experience'] },
  { title: 'Find people', items: ['Who is on hold?', 'Who could partner with APP-038?', 'Where should we open next?'] },
];
const FIELD_NAME: Record<string, string> = {
  spaceAvailable: 'space',
  spaceSizeSqft: 'space size',
  floor: 'floor',
  investmentLakh: 'investment',
  experienceYears: 'experience',
  targetLaunchMonths: 'launch timeline',
  preferredLanguage: 'language',
  languageRaw: 'language',
  pin: 'pin code',
  pinRaw: 'pin code',
  city: 'city',
  notes: 'notes',
};
const QUICK = ['Who is on hold?', 'Show partnerships', 'Who is waitlisted?', 'Where should we open next?'];

type Open = (uid: string) => void;

// ---------------------------------------------------------------- small pieces

function ApplicantChip({ r, onOpen }: { r: ApplicantRef; onOpen: Open }) {
  return (
    <button
      onClick={() => onOpen(r.uid)}
      title={`${r.appId} · ${r.name} · ${r.decision}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink transition-colors hover:border-brand-600"
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DECISION_STYLE[r.decision].dot)} aria-label={r.decision} />
      <span className="tabular font-medium">{r.appId}</span>
      <span className="truncate text-muted">{r.name}</span>
    </button>
  );
}

function ChipList({ refs, onOpen }: { refs: ApplicantRef[]; onOpen: Open }) {
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  const shown = all ? refs : refs.slice(0, LIMIT);
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">Applicants ({refs.length}) · open one to see the full record</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((r) => (
          <ApplicantChip key={r.uid} r={r} onOpen={onOpen} />
        ))}
        {refs.length > LIMIT && (
          <button onClick={() => setAll(!all)} className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
            {all ? 'Show fewer' : `Show ${refs.length - LIMIT} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ s }: { s: ReplySection }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{s.title}</p>
      <ul className={cx('space-y-1 border-l-2 pl-3 text-sm text-ink', s.tone === 'warn' ? 'border-amber-300' : s.tone === 'good' ? 'border-green-300' : 'border-line')}>
        {s.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function Links({ links, onLink }: { links: ReplyLink[]; onLink: (l: ReplyLink) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((l) => (
        <button key={`${l.kind}:${l.id}:${l.label}`} onClick={() => onLink(l)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          {l.label} <ArrowRight size={12} />
        </button>
      ))}
    </div>
  );
}

function FocusCard({ f }: { f: NonNullable<Reply['focus']> }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm">
          <span className="tabular font-medium text-ink">{f.appId}</span> <span className="text-muted">{f.name}</span>
        </p>
        <DecisionBadge decision={f.decision} />
      </div>
      <dl className="mt-2 divide-y divide-line text-sm">
        {f.numbers.map((n) => (
          <div key={n.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-muted">{n.label}</dt>
            <dd className="tabular text-right text-ink">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[11px] text-muted">Scores are out of 100 (rulebook weights). Payback uses simulated order demand.</p>
    </div>
  );
}

function CompareView({ c, onOpen }: { c: CompareTable; onOpen: Open }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-xs sm:text-sm">
        <thead className="bg-canvas">
          <tr>
            <th className="w-[36%] px-2.5 py-2 text-left font-medium text-muted"></th>
            {[c.a, c.b].map((r) => (
              <th key={r.uid} className="px-2.5 py-2 text-right">
                <button onClick={() => onOpen(r.uid)} className="tabular font-medium text-brand-700 hover:underline">
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
                <td key={k} className={cx('tabular break-words px-2.5 py-1.5 text-right', row.better === k ? 'font-medium text-ink' : 'text-muted')}>
                  {row.label === 'Decision' ? <DecisionBadge decision={row[k] as Decision} /> : row[k]}
                  {row.better === k && <span className="sr-only"> (better)</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line bg-canvas px-2.5 py-1.5 text-[11px] text-muted">The stronger value in each row is shown darker.</p>
    </div>
  );
}

function DiffView({ d, onOpen }: { d: UpdateDiff; onOpen: Open }) {
  const changedMetrics = d.metrics.filter((m) => m.changed);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line p-3">
        <p className="mb-1.5 text-xs font-medium text-muted">What changed in {d.appId}'s record</p>
        {d.understood.length ? (
          <dl className="divide-y divide-line text-sm">
            {d.understood.map((u) => (
              <div key={u.label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                <dt className="text-muted">{u.label}</dt>
                <dd className="text-right">
                  {u.from && <span className="text-muted line-through decoration-gray-300">{u.from}</span>}
                  {u.from && <span className="px-1.5 text-muted">→</span>}
                  <span className="text-ink">{u.to}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">No field changes.</p>
        )}
        {d.assumptions.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-waitlist">
            {d.assumptions.map((a, i) => (
              <li key={i}>Assumption: {a}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-canvas p-3">
          <p className="text-xs text-muted">Before</p>
          <div className="mt-1.5">
            <DecisionBadge decision={d.before.decision} />
          </div>
          <p className="mt-2 text-xs text-muted">{d.before.headline}</p>
        </div>
        <div className="flex items-center justify-center text-muted" aria-hidden>
          <ArrowRight size={16} className="rotate-90 sm:rotate-0" />
        </div>
        <div className={cx('rounded-lg border p-3', d.decisionChanged ? 'border-brand-600 bg-white' : 'border-line bg-canvas')}>
          <p className="text-xs text-muted">After{d.decisionChanged ? '' : ' (unchanged)'}</p>
          <div className="mt-1.5">
            <DecisionBadge decision={d.after.decision} />
          </div>
          <p className="mt-2 text-xs text-ink">{d.after.headline}</p>
        </div>
      </div>

      {changedMetrics.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium">Number</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Before</th>
                <th className="px-2.5 py-1.5 text-right font-medium">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {changedMetrics.map((m) => (
                <tr key={m.label}>
                  <td className="px-2.5 py-1.5 text-muted">{m.label}</td>
                  <td className="tabular px-2.5 py-1.5 text-right text-muted">{m.before}</td>
                  <td className="tabular px-2.5 py-1.5 text-right font-medium text-ink">{m.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Other applicants affected</p>
        {d.ripple.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {d.ripple.map((c) => (
              <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2">
                <button onClick={() => onOpen(c.uid)} className="min-w-0 truncate text-left text-sm hover:underline">
                  <span className="tabular font-medium text-ink">{c.appId}</span> <span className="text-muted">{c.name}</span>
                </button>
                <span className="flex items-center gap-1.5">
                  <DecisionBadge decision={c.before} />
                  <span className="text-muted">→</span>
                  <DecisionBadge decision={c.after} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None. No other decision moved when the rules re-ran.</p>
        )}
      </div>
    </div>
  );
}

function AssistantBody({ reply, onOpen, onLink, onAsk }: { reply: Reply; onOpen: Open; onLink: (l: ReplyLink) => void; onAsk: (q: string) => void }) {
  const showChips = reply.cards && reply.cards.length > 0 && !reply.compare && !(reply.focus && reply.cards.length === 1);
  return (
    <div className="space-y-3">
      <p className={cx('text-sm leading-relaxed', reply.tone === 'error' ? 'text-decline' : 'text-ink')}>{reply.text}</p>
      {reply.diff && <DiffView d={reply.diff} onOpen={onOpen} />}
      {reply.focus && <FocusCard f={reply.focus} />}
      {reply.compare && <CompareView c={reply.compare} onOpen={onOpen} />}
      {reply.bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink marker:text-gray-300">
          {reply.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {reply.sections?.map((s, i) => (
        <Section key={`${s.title}-${i}`} s={s} />
      ))}
      {showChips && <ChipList refs={reply.cards!} onOpen={onOpen} />}
      {reply.links && reply.links.length > 0 && <Links links={reply.links} onLink={onLink} />}
      {reply.followUps && reply.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
          {reply.followUps.map((q) => (
            <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink hover:border-brand-600 hover:text-brand-700">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ m, onOpen, onLink, onAsk }: { m: Msg; onOpen: Open; onLink: (l: ReplyLink) => void; onAsk: (q: string) => void }) {
  if (m.role === 'user') {
    return (
      <div data-msg className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-brand-50 px-3.5 py-2 text-sm text-ink">
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          <p className="mt-0.5 text-right text-[11px] text-muted">{timeOf(m.at)}</p>
        </div>
      </div>
    );
  }
  return (
    <div data-msg className="min-w-0 rounded-lg border border-line bg-white px-3.5 py-3 sm:max-w-[92%]">
      {m.reply ? <AssistantBody reply={m.reply} onOpen={onOpen} onLink={onLink} onAsk={onAsk} /> : <p className="text-sm">{m.text}</p>}
      <p className="mt-2.5 text-[11px] text-muted">
        StoreSense · {timeOf(m.at)} · from the rules engine{m.reply?.diff ? ' · decisions re-run' : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function AskPage() {
  const { output, parse, updateApplication, resetUpdates, openApplicant, openTerritory, openMapAt, activity, draftQuestion, setDraftQuestion } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(() => savedMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll so the newest message starts at the top of the view (long answers are read from their first line).
  useEffect(() => {
    savedMessages = msgs;
    const el = scrollRef.current;
    if (!el) return;
    const all = el.querySelectorAll<HTMLElement>('[data-msg]');
    const last = all.length ? all[all.length - 1] : null;
    const top = last && msgs[msgs.length - 1]?.role === 'assistant' ? last.offsetTop - 12 : el.scrollHeight;
    el.scrollTo({ top, behavior: 'smooth' });
  }, [msgs, busy]);

  // 'Ask about this applicant' from another page pre-fills the box.
  useEffect(() => {
    if (draftQuestion) {
      setInput(draftQuestion);
      setDraftQuestion(null);
      inputRef.current?.focus();
    }
  }, [draftQuestion, setDraftQuestion]);

  const knownIds = useMemo(() => output?.results.map((r) => r.appId) ?? [], [output]);
  const names = useMemo(() => output?.results.map((r) => ({ id: r.appId, name: r.name })) ?? [], [output]);
  const updated = useMemo(() => parse?.applications.filter((a) => a.updates && a.updates.length > 0) ?? [], [parse]);
  const hasResults = !!output && output.results.length > 0;

  const onLink = (l: ReplyLink) => {
    if (l.kind === 'applicant') openApplicant(l.id);
    else if (l.kind === 'territory') openTerritory(l.id);
    else openMapAt(l.id);
  };

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
    setMsgs((m) => [...m, { id: nextId++, role: 'user', text: q, at: new Date().toISOString() }]);
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

  const recent = activity.filter((a) => a.changes.length > 0).slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Ask about a decision"
        subtitle="Ask why an applicant got their decision, or tell StoreSense something new about them. New information re-runs the rules and shows what changed."
        actions={
          updated.length > 0 ? (
            <Button size="sm" className="whitespace-nowrap" onClick={resetUpdates} title="Undo every chat update and go back to the uploaded file">
              <RotateCcw size={13} /> Undo {updated.length} update{updated.length === 1 ? '' : 's'}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="flex h-[calc(100dvh-230px)] min-h-[460px] flex-col overflow-hidden lg:h-[calc(100dvh-200px)]">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="min-w-0 truncate text-sm text-muted">
              {hasResults ? (
                <>
                  <span className="tabular">{output!.results.length}</span> applications loaded · {LLM_ENABLED ? 'AI phrasing, facts from the rules' : 'answers come from the rules engine'}
                </>
              ) : (
                'No applications loaded'
              )}
            </p>
            {msgs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setMsgs([])}>
                Clear chat
              </Button>
            )}
          </div>

          <div ref={scrollRef} className="relative flex-1 space-y-3 overflow-y-auto bg-canvas px-3 py-4 sm:px-4">
            {!hasResults && (
              <EmptyState
                title="No decisions to ask about yet"
                body="Upload an Applications + Territories file from Data & CRM in the top bar, or wait for the sample to finish loading."
              />
            )}
            {hasResults && msgs.length === 0 && (
              <div className="mx-auto max-w-2xl py-4">
                <p className="text-sm text-ink">Start with one of these, or type your own question below.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {STARTERS.map((g) => (
                    <div key={g.title}>
                      <p className="mb-2 text-xs font-medium text-muted">{g.title}</p>
                      <div className="space-y-2">
                        {g.items.map((q) => (
                          <button
                            key={q}
                            onClick={() => void ask(q)}
                            className="block w-full rounded-lg border border-line bg-white px-3 py-2 text-left text-sm text-ink transition-colors hover:border-brand-600"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <Message key={m.id} m={m} onOpen={openApplicant} onLink={onLink} onAsk={(q) => void ask(q)} />
            ))}
            {busy && <p className="pl-1 text-xs text-muted">Re-running the rules…</p>}
          </div>

          <div className="border-t border-line bg-white px-3 py-2.5 sm:px-4">
            {msgs.length > 0 && (
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    disabled={busy || !hasResults}
                    className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink hover:border-brand-600 hover:text-brand-700 disabled:opacity-50"
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
                placeholder={hasResults ? 'e.g. Why is APP-007 on hold?' : 'Load a file first'}
                disabled={!hasResults}
                aria-label="Ask StoreSense"
                className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-canvas"
              />
              <Button type="submit" variant="primary" disabled={!input.trim() || busy || !hasResults} aria-label="Send">
                <Send size={15} />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Changed in this session" subtitle={updated.length ? 'Chat updates on top of the uploaded file' : undefined} />
            <div className="p-4">
              {updated.length === 0 ? (
                <p className="text-sm text-muted">No updates yet. Decisions match the uploaded file.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {updated.map((a) => {
                    const r = output?.results.find((x) => x.uid === a.uid);
                    return (
                      <li key={a.uid} className="py-2 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <button onClick={() => openApplicant(a.uid)} className="tabular text-sm font-medium text-ink hover:underline">
                            {a.id}
                          </button>
                          {r && <DecisionBadge decision={r.decision} />}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">Changed: {[...new Set(a.updates!.map((u) => FIELD_NAME[u.field] ?? u.field))].join(', ')}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {recent.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="mb-1.5 text-xs font-medium text-muted">Decisions that moved</p>
                  <ul className="space-y-1.5">
                    {recent.map((a, i) => (
                      <li key={i} className="text-xs text-muted">
                        <span className="tabular">{timeOf(a.at)}</span> · {a.changes.length} decision{a.changes.length === 1 ? '' : 's'} moved after “{a.text}”
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="How answers work" />
            <ul className="space-y-2 p-4 text-sm text-muted">
              <li>The rules decide, not AI. Every answer quotes the engine's reasons, scores and payback.</li>
              <li>New information re-runs every decision. Slots are re-allocated, so others in the same territory can move too.</li>
              <li>If a message leaves something out (for example the shop size), the answer lists the assumption and what to ask for.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
