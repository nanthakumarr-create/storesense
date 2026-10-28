// Sections of the Data & CRM panel: where the applications come from, the HubSpot link, the order data and the key assumptions.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronDown, Download, Upload } from 'lucide-react';
import { useApp } from '../../state/AppState';
import { DECISIONS, type Decision, type Tier } from '../../types';
import { Button, DECISION_STYLE, cx, fmtDate, fmtInt } from '../components/ui';
import { hubspotStatus, importFromHubSpot, pushToHubSpot, type HubSpotStatus } from '../../data/hubspot';
import { ACCEPTED_FORMATS } from '../../engine/ingest';
import {
  BUFFER_MONTHS,
  CAPITAL_GAP,
  COMBINED_WEIGHTS,
  CONTRIBUTION_MARGIN,
  OVERLAP_RADIUS_KM,
  PARTNER_BAR,
  PARTNER_WEIGHTS,
  PAYBACK_TARGET_MONTHS,
  SPACE_SQFT,
  TIER_ECONOMICS,
} from '../../config/rules';

// ---------------------------------------------------------------- shared bits

export function PanelSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-5 last:border-b-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line rounded-lg border border-line text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
          <dt className="text-muted">{k}</dt>
          <dd className="tabular min-w-0 text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({ tone, children }: { tone: 'good' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'good' && 'border-green-200 bg-green-50 text-approve',
        tone === 'bad' && 'border-red-200 bg-red-50 text-decline',
        tone === 'info' && 'border-line bg-canvas text-muted',
      )}
    >
      {children}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- 1. applications source


export function ApplicationsSource({ onDone }: { onDone: () => void }) {
  const { parse, output, status, error, isSample, loadFiles, loadSample } = useApp();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<null | 'file' | 'sample'>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);

  // loadFile reports problems through app state; turn the outcome into a message here.
  useEffect(() => {
    if (!pending.current || status === 'loading') return;
    const name = pending.current;
    pending.current = null;
    setBusy(null);
    if (status === 'error') setMsg({ tone: 'bad', text: `Could not read ${name}: ${error ?? 'unknown error'}` });
    else if (parse) setMsg({ tone: 'good', text: `Loaded ${parse.source.fileName}: ${parse.applications.length} applications, ${parse.territories.length} territories. Every decision has been re-run.` });
  }, [status, error, parse]);

  const readFiles = async (list: FileList | null | undefined) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const label = picked.length === 1 ? picked[0].name : `${picked.length} files`;
    setMsg(null);
    setBusy('file');
    pending.current = label;
    try {
      const files = await Promise.all(picked.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
      await loadFiles(files);
    } catch (e) {
      pending.current = null;
      setBusy(null);
      setMsg({ tone: 'bad', text: `Could not read ${label}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void readFiles(e.dataTransfer.files);
  };

  const loadSampleData = async () => {
    setMsg(null);
    setBusy('sample');
    pending.current = 'the sample file';
    await loadSample();
  };

  const counts = output?.summary.byDecision;
  const warnings = parse?.warnings ?? [];

  return (
    <PanelSection title="Applications source" subtitle="The file the decisions are built from. Any format with an applicant table works; territories can be in the same file or a second one.">
      {parse ? (
        <Rows
          rows={[
            ['File', <span className="block break-words">{parse.source.fileName}{isSample && <span className="block text-xs text-muted">Sample data</span>}</span>],
            ['Applications', fmtInt(parse.applications.length)],
            ['Territories', fmtInt(parse.territories.length)],
            ['Existing stores', `${parse.stores.length} (${parse.source.storesFromFile ? 'from the file' : 'built-in list'})`],
            ['Open slots filled', output ? `${output.summary.slotsFilled} of ${output.summary.slotsTotal}` : '—'],
          ]}
        />
      ) : (
        <Notice tone="info">No file loaded yet.</Notice>
      )}

      {counts && (
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {DECISIONS.map((d: Decision) => (
            <li key={d} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-muted">
                <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DECISION_STYLE[d].dot)} />
                {DECISION_STYLE[d].short}
              </span>
              <span className="tabular text-ink">{counts[d]}</span>
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <div className="mt-3">
          <Collapsible label={`${warnings.length} file note${warnings.length === 1 ? '' : 's'} from reading the file`}>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Collapsible>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        className={cx(
          'mt-4 flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          drag ? 'border-brand-600 bg-brand-50' : 'border-gray-300 bg-white hover:border-brand-600',
        )}
      >
        <Upload size={18} className="text-muted" />
        <p className="text-sm font-medium text-ink">{busy === 'file' ? 'Reading…' : 'Upload files'}</p>
        <p className="text-xs text-muted">Drag files here or click to choose. You can pick several at once (e.g. applicants + territories).</p>
        <p className="text-[11px] text-muted">{ACCEPTED_FORMATS}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void readFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void loadSampleData()} disabled={busy !== null}>
          {busy === 'sample' ? 'Loading…' : 'Use sample data (200 applicants)'}
        </Button>
        <a
          href="/sample/Case1_Franchise_Test_Data_Format.xlsx"
          download
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-slate-50"
        >
          <Download size={13} /> Download blank template
        </a>
      </div>

      {msg && (
        <div className="mt-3 space-y-2">
          <Notice tone={msg.tone}>{msg.text}</Notice>
          {msg.tone === 'good' && (
            <Button size="sm" variant="primary" onClick={onDone}>
              See the applications
            </Button>
          )}
        </div>
      )}
    </PanelSection>
  );
}

// ---------------------------------------------------------------- 2. HubSpot

type Job<T> = { state: 'idle' } | { state: 'busy' } | { state: 'done'; data: T } | { state: 'error'; message: string };

export function HubSpotSection({ open }: { open: boolean }) {
  const { parse, output, loadFile } = useApp();
  const [status, setStatus] = useState<HubSpotStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [imp, setImp] = useState<Job<{ count: number }>>({ state: 'idle' });
  const [push, setPush] = useState<Job<{ created: number; updated: number; byStage: Record<string, number> }>>({ state: 'idle' });

  const check = async () => {
    setChecking(true);
    const s = await hubspotStatus();
    // A non-JSON or unexpected reply means the endpoint is not there: treat as not connected.
    setStatus(s.connected === true ? s : { connected: false, reason: s.reason ?? (s as { error?: string }).error ?? 'The HubSpot endpoint did not answer.' });
    setChecking(false);
  };

  useEffect(() => {
    if (open && !status && !checking) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doImport = async () => {
    setImp({ state: 'busy' });
    try {
      const r = await importFromHubSpot(parse);
      await loadFile(r.data, r.fileName);
      setImp({ state: 'done', data: { count: r.count } });
    } catch (e) {
      setImp({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const doPush = async () => {
    if (!output) return;
    setPush({ state: 'busy' });
    try {
      const r = await pushToHubSpot(output);
      setPush({ state: 'done', data: r });
      void check(); // refresh the deal count
    } catch (e) {
      setPush({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const connected = status?.connected === true;
  const disabledReason = !status ? 'Checking the connection…' : !connected ? 'HubSpot is not connected.' : null;

  return (
    <PanelSection title="HubSpot CRM" subtitle="Pull applicants in as contacts, and push every decision back as a deal.">
      {checking && !status ? (
        <Notice tone="info">Checking the HubSpot connection…</Notice>
      ) : connected ? (
        <Rows
          rows={[
            ['Status', <span className="text-approve">Connected</span>],
            ['Applicants as contacts', status!.contacts !== undefined ? fmtInt(status!.contacts) : '—'],
            ['Decisions as deals', status!.deals !== undefined ? fmtInt(status!.deals) : '—'],
            ['Pipeline', status!.pipeline ?? 'Franchise Pipeline'],
          ]}
        />
      ) : status ? (
        <Notice tone="info">
          Not connected. {status.reason}{' '}
          <button onClick={() => void check()} className="font-medium text-brand-700 hover:underline">
            Try again
          </button>
        </Notice>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void doImport()} disabled={!connected || imp.state === 'busy'} title={disabledReason ?? 'Replaces the current applications with the HubSpot contacts'}>
          {imp.state === 'busy' ? 'Importing…' : 'Import applicants from HubSpot'}
        </Button>
        <Button size="sm" onClick={() => void doPush()} disabled={!connected || !output || push.state === 'busy'} title={disabledReason ?? 'Creates or updates one deal per applicant'}>
          {push.state === 'busy' ? 'Pushing…' : 'Push decisions to HubSpot'}
        </Button>
      </div>
      {disabledReason && status && <p className="mt-2 text-xs text-muted">Both buttons are off because {disabledReason.toLowerCase()}</p>}

      <div className="mt-3 space-y-2">
        {imp.state === 'done' && <Notice tone="good">Imported {fmtInt(imp.data.count)} applicants from HubSpot and re-ran every decision. Territories and stores were kept from the current plan.</Notice>}
        {imp.state === 'error' && <Notice tone="bad">Import failed: {imp.message}. The current file is unchanged.</Notice>}
        {push.state === 'done' && (
          <div className="space-y-2">
            <Notice tone="good">
              Pushed {fmtInt(push.data.created + push.data.updated)} decisions: {fmtInt(push.data.created)} deals created, {fmtInt(push.data.updated)} updated.
            </Notice>
            {Object.keys(push.data.byStage).length > 0 && (
              <Rows rows={Object.entries(push.data.byStage).map(([stage, n]) => [stage, fmtInt(n)] as [string, ReactNode])} />
            )}
          </div>
        )}
        {push.state === 'error' && <Notice tone="bad">Push failed: {push.message}. Nothing in StoreSense changed.</Notice>}
      </div>
    </PanelSection>
  );
}

// ---------------------------------------------------------------- 3. order data

export function OrderDataSection() {
  const { demandSource, ctx } = useApp();
  const rows = ctx ? Object.values(ctx.demand) : [];
  const orders = rows.reduce((s, d) => s + (d.orders || 0), 0);
  const live = demandSource?.source === 'supabase';
  return (
    <PanelSection title="Order data" subtitle="Where the demand numbers on the map and in each payback come from.">
      <Rows
        rows={[
          ['Source', demandSource ? (live ? 'Supabase (live database)' : 'Bundled copy in the app') : '—'],
          ['Fetched', demandSource ? `${fmtDate(demandSource.fetchedAt.slice(0, 10))}, ${new Date(demandSource.fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '—'],
          ['Pin codes with order data', rows.length ? fmtInt(rows.length) : '—'],
          ['Orders in the data', orders ? `${fmtInt(orders)} (simulated)` : '—'],
          ['Stores with catchment data', ctx ? fmtInt(ctx.catchment.length) : '—'],
        ]}
      />
      {demandSource?.error && !live && <p className="mt-2 text-xs text-muted">Using the bundled copy because: {demandSource.error}.</p>}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Simulated online and store orders per Bengaluru pin code for the last 12 months, from a sample of customers scaled so today's five Bengaluru stores match the
        Tier 1 sales assumption. Other cities use a demand estimate from city tier and distance to the centre. In production this is a monthly export of orders by
        pin code from the order system.
      </p>
    </PanelSection>
  );
}

// ---------------------------------------------------------------- 4. assumptions

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function AssumptionsSection() {
  const tiers: Tier[] = ['Tier 1', 'Tier 2', 'Tier 3'];
  return (
    <PanelSection title="Assumptions" subtitle="Rulebook numbers the engine uses. All are assumptions to check in the pilot.">
      <Collapsible label="Show the key numbers">
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium">Per store</th>
                {tiers.map((t) => (
                  <th key={t} className="px-2.5 py-1.5 text-right font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line">
              <tr>
                <td className="px-2.5 py-1.5 text-muted">Investment</td>
                {tiers.map((t) => (
                  <td key={t} className="px-2.5 py-1.5 text-right">₹{TIER_ECONOMICS[t].investmentLakh}L</td>
                ))}
              </tr>
              <tr>
                <td className="px-2.5 py-1.5 text-muted">Base sales / month</td>
                {tiers.map((t) => (
                  <td key={t} className="px-2.5 py-1.5 text-right">₹{TIER_ECONOMICS[t].baseSalesLakh}L</td>
                ))}
              </tr>
              <tr>
                <td className="px-2.5 py-1.5 text-muted">Fixed cost / month</td>
                {tiers.map((t) => (
                  <td key={t} className="px-2.5 py-1.5 text-right">₹{TIER_ECONOMICS[t].fixedCostLakh}L</td>
                ))}
              </tr>
              <tr>
                <td className="px-2.5 py-1.5 text-muted">Overlap radius</td>
                {tiers.map((t) => (
                  <td key={t} className="px-2.5 py-1.5 text-right">{OVERLAP_RADIUS_KM[t]} km</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Rows
            rows={[
              ['Payback target', `≤ ${PAYBACK_TARGET_MONTHS} months`],
              ['Contribution margin', pct(CONTRIBUTION_MARGIN)],
              ['Cash buffer on top of investment', `${BUFFER_MONTHS} months of fixed cost`],
              ['Capital gap allowed', `≤ ${pct(CAPITAL_GAP.conditionMax)} with a condition, > ${pct(CAPITAL_GAP.compactMax)} declined`],
              ['Shop size', `${SPACE_SQFT.ideal} sq ft ideal, ${SPACE_SQFT.compactMin} sq ft minimum`],
              ['Partner score bar', `${PARTNER_BAR.strong}+ strong, ${PARTNER_BAR.conditional}–${PARTNER_BAR.strong - 1} with conditions`],
              [
                'Partner score weights',
                `Experience ${pct(PARTNER_WEIGHTS.experience)}, relevance ${pct(PARTNER_WEIGHTS.relevance)}, commitment ${pct(PARTNER_WEIGHTS.commitment)}, capital ${pct(PARTNER_WEIGHTS.capitalFit)}, involvement ${pct(PARTNER_WEIGHTS.involvement)}`,
              ],
              ['Ranking within a territory', `Partner ${pct(COMBINED_WEIGHTS.partner)}, place ${pct(COMBINED_WEIGHTS.place)}, readiness ${pct(COMBINED_WEIGHTS.readiness)}`],
              ['Same pin as a store', 'Never allowed'],
            ]}
          />
        </div>
      </Collapsible>
    </PanelSection>
  );
}
