import { useState, type ReactNode } from 'react';
import { BarChart3, Database, ListChecks, Map as MapIcon, Menu, MessageSquare, Rocket, Store, X, LayoutGrid } from 'lucide-react';
import { useApp, type Page } from './state/AppState';
import { cx, Spinner, Button } from './ui/components/ui';
import { AS_OF_DATE } from './config/rules';
import { OverviewPage } from './ui/pages/OverviewPage';
import { PipelinePage } from './ui/pages/PipelinePage';
import { MapPage } from './ui/pages/MapPage';
import { TerritoriesPage } from './ui/pages/TerritoriesPage';
import { LaunchPlansPage } from './ui/pages/LaunchPlansPage';
import { AskPage } from './ui/pages/AskPage';
import { DataSourcesPage } from './ui/pages/DataSourcesPage';
import { ApplicantDrawer } from './ui/components/ApplicantDrawer';

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: 'overview', label: 'Overview', icon: <BarChart3 size={18} /> },
  { page: 'pipeline', label: 'Applications', icon: <ListChecks size={18} /> },
  { page: 'map', label: 'Demand map', icon: <MapIcon size={18} /> },
  { page: 'territories', label: 'Territories', icon: <LayoutGrid size={18} /> },
  { page: 'plans', label: 'Launch plans', icon: <Rocket size={18} /> },
  { page: 'ask', label: 'Ask StoreSense', icon: <MessageSquare size={18} /> },
  { page: 'data', label: 'Data sources', icon: <Database size={18} /> },
];

const PAGES: Record<Page, () => ReactNode> = {
  overview: () => <OverviewPage />,
  pipeline: () => <PipelinePage />,
  map: () => <MapPage />,
  territories: () => <TerritoriesPage />,
  plans: () => <LaunchPlansPage />,
  ask: () => <AskPage />,
  data: () => <DataSourcesPage />,
};

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { page, setPage, output } = useApp();
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white">
          <Store size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">StoreSense</p>
          <p className="text-[11px] leading-tight text-slate-400">Expansion console</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => (
          <li key={n.page}>
            <button
              onClick={() => {
                setPage(n.page);
                onNavigate?.();
              }}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                page === n.page ? 'bg-white/10 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
              )}
            >
              {n.icon}
              <span className="flex-1 text-left">{n.label}</span>
              {n.page === 'pipeline' && output && <span className="tabular text-xs text-slate-500">{output.summary.total}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
        <p>StoreSense Eyewear (simulated brand)</p>
        <p>Decisions as of {AS_OF_DATE}</p>
      </div>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { parse, demandSource, isSample, setPage } = useApp();
  return (
    <header className="sticky top-0 z-[500] flex items-center gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur lg:px-6">
      <button className="rounded-lg p-1.5 text-muted hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1 truncate text-xs text-muted">
        {parse ? (
          <>
            <span className="font-medium text-ink">{parse.source.fileName}</span>
            {isSample && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-waitlist">Sample data</span>}
          </>
        ) : (
          'No file loaded'
        )}
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium', demandSource?.source === 'supabase' ? 'bg-green-50 text-approve' : 'bg-slate-100 text-slate-600')}>
          <span className={cx('h-1.5 w-1.5 rounded-full', demandSource?.source === 'supabase' ? 'bg-approve' : 'bg-slate-400')} />
          Orders: {demandSource?.source === 'supabase' ? 'Supabase live' : 'bundled copy'}
        </span>
      </div>
      <Button variant="primary" size="sm" onClick={() => setPage('data')}>
        Upload file
      </Button>
    </header>
  );
}

export default function App() {
  const { page, status, error, loadSample } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block">
        <Sidebar />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900">
            <button className="absolute right-3 top-4 text-slate-400" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6 lg:py-6">
            {status === 'loading' && !error && (
              <div className="py-24">
                <Spinner label="Reading applications and running the rules…" />
              </div>
            )}
            {status === 'error' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-decline">
                <p className="font-semibold">Could not process the file</p>
                <p className="mt-1">{error}</p>
                <Button className="mt-3" onClick={() => void loadSample()}>
                  Load sample data instead
                </Button>
              </div>
            )}
            {status === 'ready' && PAGES[page]()}
          </div>
        </main>
      </div>
      <ApplicantDrawer />
    </div>
  );
}
