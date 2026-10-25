// Data sources: upload the judges' file, see what was read, where order data and CRM data come from, and the rule numbers.
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, CloudDownload, CloudUpload, Database, Download, FileSpreadsheet, Info, Link2Off, Plug, RefreshCw, Store, Upload,
} from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { Tier } from '../../types';
import { Button, Card, CardHeader, PageHeader, Pill, Spinner, cx, fmtInt, fmtLakh } from '../components/ui';
import { EXISTING_STORES } from '../../data/existingStores';
import {
  BUFFER_MONTHS, CAPITAL_GAP, COMBINED_WEIGHTS, CONTRIBUTION_MARGIN, FLOOR_FACTOR, OVERLAP_RADIUS_KM, PARTNER_BAR, PARTNER_WEIGHTS,
  PAYBACK_TARGET_MONTHS, SPACE_SQFT, TIER_ECONOMICS, ZERO_EXPERIENCE_MIN_SCORE, MAX_CONDITIONS_FOR_APPROVAL,
} from '../../config/rules';
import { ToastStack, useToasts } from '../dashboard/toast';

/* ---------- small helpers ---------- */

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular text-right font-medium text-ink">{v}</dd>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', ok === null ? 'bg-slate-100 text-slate-600' : ok ? 'bg-green-50 text-approve' : 'bg-amber-50 text-waitlist')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', ok === null ? 'bg-slate-400' : ok ? 'bg-approve' : 'bg-waitlist')} />
      {label}
    </span>
  );
}

const ago = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pctW = (w: number) => `${Math.round(w * 100)}%`;

/* ---------- upload ---------- */

function Dropzone() {
  const { loadFile, loadSample, status } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (file: File | undefined) => {
    setErr(null);
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setErr(`"${file.name}" is not an Excel file. Upload the .xlsx template with the Applications and Territories sheets.`);
      return;
    }
    setBusy(true);
    try {
      await loadFile(await file.arrayBuffer(), file.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void handle(e.dataTransfer.files?.[0]);
  };

  return (
    <Card>
      <CardHeader title="Upload applications" subtitle="Excel file in the case template: Applications + Territories sheets (Existing stores optional)." />
      <div className="space-y-3 p-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60 hover:border-brand-500 hover:bg-brand-50/40',
          )}
        >
          {busy || status === 'loading' ? (
            <Spinner label="Reading the file and running the rules…" />
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm ring-1 ring-line"><Upload size={20} /></span>
              <p className="text-sm font-semibold text-ink">Drop the Excel file here, or click to choose</p>
              <p className="text-xs text-muted">.xlsx or .xls · nothing leaves your browser · every applicant gets a decision in seconds</p>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              void handle(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {err && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-decline">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            {err}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="primary" onClick={() => void loadSample()}><RefreshCw size={14} />Load sample data (200 applicants)</Button>
          <a href="/sample/Case1_Franchise_Test_Data_Format.xlsx" download className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-slate-50">
            <Download size={14} />Download blank template
          </a>
          <a href="/sample/StoreSense_Applicants_200.xlsx" download className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-slate-50">
            <FileSpreadsheet size={14} />Download sample file
          </a>
        </div>
      </div>
    </Card>
  );
}

/* ---------- source cards ---------- */

function ApplicationsSource() {
  const { parse, output, isSample } = useApp();
  if (!parse) {
    return (
      <Card>
        <CardHeader title="Applications file" />
        <p className="p-4 text-sm text-muted">No file loaded yet.</p>
      </Card>
    );
  }
  const src = parse.source;
  const flagged = parse.applications.filter((a) => a.flags.length > 0).length;
  const dataIssues = output?.summary.dataIssues ?? flagged;
  const hasSheet = (re: RegExp) => src.sheetNames.some((n) => re.test(n));
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><FileSpreadsheet size={15} className="text-brand-700" />Applications file</span>}
        subtitle={<span className="break-all">{src.fileName}</span>}
        action={<Status ok={true} label={isSample ? 'Sample loaded' : 'Loaded'} />}
      />
      <div className="px-4 py-2">
        <dl className="divide-y divide-line">
          <KV k="Sheets found" v={<span className="flex flex-wrap justify-end gap-1">{src.sheetNames.length ? src.sheetNames.map((n) => <Pill key={n}>{n}</Pill>) : '—'}</span>} />
          <KV k="Applications read" v={fmtInt(parse.applications.length)} />
          <KV k="Territories read" v={fmtInt(parse.territories.length)} />
          <KV k="Existing stores" v={src.storesFromFile ? `${parse.stores.length} from file` : `${EXISTING_STORES.length} (fixed list)`} />
          <KV k="Example row dropped" v={src.exampleRowDropped ? <span className="text-approve">Yes</span> : 'No (not present or edited)'} />
          <KV k="Blank rows skipped" v={src.blankRowsSkipped} />
          <KV k="Rows with data issues" v={<span className={dataIssues ? 'text-waitlist' : 'text-approve'}>{dataIssues}</span>} />
        </dl>
        {!hasSheet(/terr/i) && src.sheetNames.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-waitlist">No Territories sheet found. Applicants cannot be matched to slots.</p>
        )}
      </div>
      {parse.warnings.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">File warnings ({parse.warnings.length})</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {parse.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-700"><Info size={13} className="mt-px shrink-0 text-waitlist" />{w}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function OrdersSource() {
  const { demandSource, ctx } = useApp();
  const live = demandSource?.source === 'supabase';
  const stats = useMemo(() => {
    if (!ctx) return null;
    const rows = Object.values(ctx.demand);
    return {
      pins: rows.length,
      online: rows.reduce((n, d) => n + (d.online_orders || 0), 0),
      orders: rows.reduce((n, d) => n + (d.orders || 0), 0),
      stores: ctx.catchment.length,
    };
  }, [ctx]);
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Database size={15} className="text-brand-700" />Order data (Supabase)</span>}
        subtitle="Demand per pin code, used to rank places"
        action={<Status ok={demandSource ? live : null} label={!demandSource ? 'Loading' : live ? 'Live' : 'Bundled copy'} />}
      />
      <div className="px-4 py-2">
        <dl className="divide-y divide-line">
          <KV k="Source" v={live ? 'Supabase · storesense schema' : 'Copy bundled with the app'} />
          <KV k="Fetched" v={demandSource ? ago(demandSource.fetchedAt) : '—'} />
          <KV k="Pins with order data" v={stats ? fmtInt(stats.pins) : '—'} />
          <KV k="Orders in the data" v={stats ? `${fmtInt(stats.orders)} (${fmtInt(stats.online)} online)` : '—'} />
          <KV k="Store catchments" v={stats ? stats.stores : '—'} />
        </dl>
        {demandSource?.error && !live && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">Live fetch not used: {demandSource.error}. Same numbers, served from the bundled copy, so decisions do not change.</p>
        )}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-slate-700">
        <span className="font-medium">Simulated online-order data</span> (Bengaluru pins). In production this is the monthly export of orders by pin code from the order system. Other cities use a tier-based demand proxy.
      </p>
    </Card>
  );
}

interface HubSpotStatus {
  connected: boolean;
  portalId?: string | number;
  pipeline?: string;
  contacts?: number;
}

function HubSpotSource() {
  const [state, setState] = useState<{ loading: boolean; data: HubSpotStatus | null; err: string | null }>({ loading: true, data: null, err: null });
  const [busy, setBusy] = useState<'import' | 'push' | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const check = async () => {
    setState({ loading: true, data: null, err: null });
    try {
      const res = await fetch('/api/hubspot/status', { headers: { accept: 'application/json' } });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('json')) throw new Error(res.ok ? 'Endpoint not available' : `HTTP ${res.status}`);
      const data = (await res.json()) as HubSpotStatus;
      setState({ loading: false, data, err: null });
    } catch (e) {
      setState({ loading: false, data: null, err: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    void check();
  }, []);

  const call = async (kind: 'import' | 'push') => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/hubspot/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; count?: number };
      if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
      push({
        tone: 'good',
        title: kind === 'import' ? 'Applicants imported from HubSpot' : 'Decisions pushed to HubSpot',
        body: body.message ?? (body.count !== undefined ? `${body.count} records` : undefined),
      });
    } catch (e) {
      push({ tone: 'bad', title: kind === 'import' ? 'Import failed' : 'Push failed', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const connected = !!state.data?.connected;
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Plug size={15} className="text-brand-700" />HubSpot CRM</span>}
        subtitle="Where franchise leads live in production"
        action={<Status ok={state.loading ? null : connected} label={state.loading ? 'Checking' : connected ? 'Connected' : 'Not connected'} />}
      />
      <div className="px-4 py-2">
        {state.loading ? (
          <div className="py-3"><Spinner label="Checking the connection…" /></div>
        ) : connected ? (
          <dl className="divide-y divide-line">
            <KV k="Portal" v={state.data?.portalId ?? '—'} />
            <KV k="Pipeline" v={state.data?.pipeline ?? '—'} />
            <KV k="Contacts" v={state.data?.contacts !== undefined ? fmtInt(state.data.contacts) : '—'} />
          </dl>
        ) : (
          <div className="flex gap-2 py-2 text-sm text-muted">
            <Link2Off size={16} className="mt-0.5 shrink-0" />
            <p>Not connected in this environment. Upload the Excel export instead; the decisions are the same.{state.data && !state.data.connected ? '' : state.err ? ` (${state.err})` : ''}</p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row">
        <Button size="sm" disabled={!connected || busy !== null} onClick={() => void call('import')}>
          {busy === 'import' ? <RefreshCw size={13} className="animate-spin" /> : <CloudDownload size={13} />}Import applicants from HubSpot
        </Button>
        <Button size="sm" disabled={!connected || busy !== null} onClick={() => void call('push')}>
          {busy === 'push' ? <RefreshCw size={13} className="animate-spin" /> : <CloudUpload size={13} />}Push decisions to HubSpot
        </Button>
        {!state.loading && !connected && (
          <Button size="sm" variant="ghost" onClick={() => void check()}><RefreshCw size={13} />Check again</Button>
        )}
      </div>
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </Card>
  );
}

function StoresTable() {
  const { parse } = useApp();
  const stores = parse?.stores.length ? parse.stores : EXISTING_STORES;
  const fromFile = !!parse?.source.storesFromFile;
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Store size={15} className="text-brand-700" />Existing stores</span>}
        subtitle={fromFile ? 'Read from the uploaded file' : 'Fixed sheet from the case (used when the file has none)'}
        action={<Pill tone="brand">{stores.length} stores</Pill>}
      />
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
        {stores.map((s, i) => (
          <div key={s.id} className={cx('flex items-center gap-3 px-4 py-2', i >= 2 && 'sm:border-t sm:border-line')}>
            <span className="tabular w-12 shrink-0 text-xs font-semibold text-ink">{s.id}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.city}</span>
            <span className="tabular text-sm text-muted">{s.pin}</span>
            <span className="tabular w-10 text-right text-xs text-muted">{s.opened}</span>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">No new store is ever approved in one of these pin codes.</p>
    </Card>
  );
}

/* ---------- assumptions ---------- */

function Assumptions() {
  const tiers: Tier[] = ['Tier 1', 'Tier 2', 'Tier 3'];
  return (
    <Card>
      <CardHeader title="Assumptions behind every decision" subtitle="All numbers are assumptions to validate in the pilot. They live in one rules file." />
      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Store economics by city tier</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  <th className="py-1.5 pr-2 font-medium">Tier</th>
                  <th className="px-2 py-1.5 text-right font-medium">Investment</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sales / mo</th>
                  <th className="px-2 py-1.5 text-right font-medium">Fixed cost / mo</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Total cash need</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {tiers.map((t) => {
                  const e = TIER_ECONOMICS[t];
                  return (
                    <tr key={t}>
                      <td className="py-1.5 pr-2 font-medium text-ink">{t}</td>
                      <td className="px-2 py-1.5 text-right">{fmtLakh(e.investmentLakh)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtLakh(e.baseSalesLakh)}</td>
                      <td className="px-2 py-1.5 text-right">₹{e.fixedCostLakh.toFixed(2)}L</td>
                      <td className="py-1.5 pl-2 text-right font-medium">₹{(e.investmentLakh + BUFFER_MONTHS * e.fixedCostLakh).toFixed(1)}L</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 divide-y divide-line">
            <KV k="Payback target" v={`≤ ${PAYBACK_TARGET_MONTHS} months`} />
            <KV k="Contribution margin" v={pctW(CONTRIBUTION_MARGIN)} />
            <KV k="Cash buffer" v={`${BUFFER_MONTHS} months of fixed cost`} />
            <KV k="Floor effect on sales" v={Object.entries(FLOOR_FACTOR).map(([f, v]) => `${f} ×${v}`).join(' · ')} />
            <KV k="Capital gap" v={`≤${pctW(CAPITAL_GAP.conditionMax)} condition · >${pctW(CAPITAL_GAP.compactMax)} decline`} />
            <KV k="Space" v={`${SPACE_SQFT.ideal}+ sq ft ideal · ${SPACE_SQFT.compactMin}+ compact`} />
          </dl>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Partner score weights</p>
          <ul className="space-y-2">
            {(
              [
                ['Retail experience', PARTNER_WEIGHTS.experience],
                ['Business relevance', PARTNER_WEIGHTS.relevance],
                ['Commitment (space, manager)', PARTNER_WEIGHTS.commitment],
                ['Capital fit', PARTNER_WEIGHTS.capitalFit],
                ['Owner involvement', PARTNER_WEIGHTS.involvement],
              ] as const
            ).map(([label, w]) => (
              <li key={label} className="text-sm">
                <div className="flex justify-between"><span className="text-ink">{label}</span><span className="tabular font-medium">{pctW(w)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(w / 0.4) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          <dl className="mt-3 divide-y divide-line">
            <KV k="Partner bars" v={`${PARTNER_BAR.strong}+ strong · ${PARTNER_BAR.conditional}–${PARTNER_BAR.strong - 1} conditional · <${PARTNER_BAR.conditional} decline`} />
            <KV k="Zero experience" v={`Only with a trained manager + training, score ≥ ${ZERO_EXPERIENCE_MIN_SCORE}`} />
            <KV k="Overlap radius" v={(Object.entries(OVERLAP_RADIUS_KM) as [Tier, number][]).map(([t, km]) => `${t.replace('Tier ', 'T')} ${km} km`).join(' · ')} />
            <KV k="Slot ranking" v={`${pctW(COMBINED_WEIGHTS.partner)} partner · ${pctW(COMBINED_WEIGHTS.place)} place · ${pctW(COMBINED_WEIGHTS.readiness)} readiness`} />
            <KV k="Too many conditions" v={`More than ${MAX_CONDITIONS_FOR_APPROVAL} → waitlist`} />
            <KV k="Same pin rule" v="Never two stores in one pin" />
          </dl>
        </div>
      </div>
      <p className="flex items-center gap-1.5 border-t border-line bg-amber-50/50 px-4 py-2.5 text-xs text-waitlist">
        <AlertTriangle size={13} />All numbers are assumptions to validate in the pilot.
      </p>
    </Card>
  );
}

export function DataSourcesPage() {
  const { parse } = useApp();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Data sources"
        subtitle="Upload a new file, see exactly what was read, and check the numbers behind the rules."
        actions={parse ? <span className="inline-flex items-center gap-1.5 text-xs text-approve"><CheckCircle2 size={14} />{parse.applications.length} applications in use</span> : undefined}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Dropzone />
        <ApplicationsSource />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <OrdersSource />
        <HubSpotSource />
      </div>
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-2"><StoresTable /></div>
        <div className="xl:col-span-3"><Assumptions /></div>
      </div>
    </div>
  );
}
