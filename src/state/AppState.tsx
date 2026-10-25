// App-wide state: the uploaded file, chat updates on top of it, and the engine output.
// The engine is re-run from scratch on every change (it is fast and deterministic).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Application, DecisionChange, EngineContext, EngineOutput, ParseResult, Result } from '../types';
import { parseWorkbook } from '../engine/parse';
import { runAll } from '../engine';
import { fetchSampleWorkbook, loadEngineContext, type DemandSourceInfo } from '../data/loaders';
import { AS_OF_DATE } from '../config/rules';

export type Page = 'overview' | 'pipeline' | 'map' | 'territories' | 'plans' | 'ask' | 'data';

export interface UpdateOutcome {
  target: { before: Result; after: Result } | null;
  changes: DecisionChange[]; // every applicant whose decision changed, target first
}

export interface ActivityItem {
  at: string;
  text: string;
  changes: DecisionChange[];
}

interface AppState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  ctx: EngineContext | null;
  demandSource: DemandSourceInfo | null;
  parse: ParseResult | null;
  output: EngineOutput | null;
  isSample: boolean;
  activity: ActivityItem[];
  page: Page;
  setPage: (p: Page) => void;
  selectedUid: string | null;
  openApplicant: (uid: string | null) => void;
  loadFile: (data: ArrayBuffer, fileName: string) => Promise<void>;
  loadSample: () => Promise<void>;
  /** Apply new information about one applicant, re-run, and report every decision that moved. */
  updateApplication: (uid: string, patch: Partial<Application>, sourceText: string) => UpdateOutcome;
  resetUpdates: () => void;
  resultByUid: (uid: string) => Result | undefined;
  findResult: (idOrName: string) => Result | undefined;
}

const Ctx = createContext<AppState | null>(null);

function applyPatches(parse: ParseResult, patches: Record<string, Partial<Application>>): ParseResult {
  if (!Object.keys(patches).length) return parse;
  return { ...parse, applications: parse.applications.map((a) => (patches[a.uid] ? { ...a, ...patches[a.uid] } : a)) };
}

function diff(before: EngineOutput, after: EngineOutput, targetUid: string): DecisionChange[] {
  const prev = new Map(before.results.map((r) => [r.uid, r]));
  const changes: DecisionChange[] = [];
  for (const r of after.results) {
    const b = prev.get(r.uid);
    if (b && b.decision !== r.decision) changes.push({ uid: r.uid, appId: r.appId, name: r.name, before: b.decision, after: r.decision, why: r.headline });
  }
  return changes.sort((a, b) => (a.uid === targetUid ? -1 : b.uid === targetUid ? 1 : a.appId.localeCompare(b.appId)));
}

const PAGES: Page[] = ['overview', 'pipeline', 'map', 'territories', 'plans', 'ask', 'data'];
const pageFromHash = (): Page => {
  const h = window.location.hash.replace('#/', '') as Page;
  return PAGES.includes(h) ? h : 'overview';
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<EngineContext | null>(null);
  const [demandSource, setDemandSource] = useState<DemandSourceInfo | null>(null);
  const [baseParse, setBaseParse] = useState<ParseResult | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<Application>>>({});
  const [isSample, setIsSample] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const ctxRef = useRef<EngineContext | null>(null);

  const parse = useMemo(() => (baseParse ? applyPatches(baseParse, patches) : null), [baseParse, patches]);
  const output = useMemo(() => (parse && ctx ? runAll(parse, ctx) : null), [parse, ctx]);

  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setPage = useCallback((p: Page) => {
    window.location.hash = `#/${p}`;
    setPageState(p);
  }, []);

  const ensureCtx = useCallback(async () => {
    if (ctxRef.current) return ctxRef.current;
    const { ctx: c, info } = await loadEngineContext();
    ctxRef.current = c;
    setCtx(c);
    setDemandSource(info);
    return c;
  }, []);

  const loadFile = useCallback(
    async (data: ArrayBuffer, fileName: string) => {
      setStatus('loading');
      setError(null);
      try {
        await ensureCtx();
        const p = parseWorkbook(data, fileName);
        setBaseParse(p);
        setPatches({});
        setIsSample(fileName === 'StoreSense_Applicants_200.xlsx');
        setActivity([{ at: new Date().toISOString(), text: `Loaded ${fileName}: ${p.applications.length} applications, ${p.territories.length} territories`, changes: [] }]);
        setSelectedUid(null);
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [ensureCtx],
  );

  const loadSample = useCallback(async () => {
    try {
      const buf = await fetchSampleWorkbook();
      await loadFile(buf, 'StoreSense_Applicants_200.xlsx');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [loadFile]);

  // First visit: show the console with the sample file so it is never empty; judges replace it with their own upload.
  useEffect(() => {
    void loadSample();
  }, [loadSample]);

  const updateApplication = useCallback(
    (uid: string, patch: Partial<Application>, sourceText: string): UpdateOutcome => {
      if (!baseParse || !ctx || !parse || !output) return { target: null, changes: [] };
      const current = parse.applications.find((a) => a.uid === uid);
      if (!current) return { target: null, changes: [] };
      const at = new Date().toISOString();
      const log = Object.entries(patch)
        .filter(([k]) => k !== 'updates' && k !== 'flags')
        .map(([field, to]) => ({ field, from: current[field as keyof Application], to, at, source: sourceText }));
      const merged: Partial<Application> = { ...patches[uid], ...patch, updates: [...(current.updates ?? []), ...log] };
      const nextPatches = { ...patches, [uid]: merged };
      const nextOutput = runAll(applyPatches(baseParse, nextPatches), ctx);
      setPatches(nextPatches);
      const changes = diff(output, nextOutput, uid);
      const before = output.results.find((r) => r.uid === uid);
      const after = nextOutput.results.find((r) => r.uid === uid);
      setActivity((a) => [{ at, text: `${current.id}: ${sourceText}`, changes }, ...a]);
      return { target: before && after ? { before, after } : null, changes };
    },
    [baseParse, ctx, parse, output, patches],
  );

  const resetUpdates = useCallback(() => {
    setPatches({});
    setActivity((a) => [{ at: new Date().toISOString(), text: 'All chat updates cleared; decisions back to the uploaded file', changes: [] }, ...a]);
  }, []);

  const byUid = useMemo(() => new Map(output?.results.map((r) => [r.uid, r]) ?? []), [output]);
  const resultByUid = useCallback((uid: string) => byUid.get(uid), [byUid]);
  const findResult = useCallback(
    (q: string) => {
      const s = q.trim().toLowerCase();
      if (!output) return undefined;
      return (
        output.results.find((r) => r.appId.toLowerCase() === s || r.uid.toLowerCase() === s) ??
        output.results.find((r) => r.name.toLowerCase() === s)
      );
    },
    [output],
  );

  const value: AppState = {
    status, error, ctx, demandSource, parse, output, isSample, activity, page, setPage,
    selectedUid, openApplicant: setSelectedUid, loadFile, loadSample, updateApplication, resetUpdates, resultByUid, findResult,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppStateProvider');
  return v;
}

export { AS_OF_DATE };
