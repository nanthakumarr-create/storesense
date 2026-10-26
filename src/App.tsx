import { useState, type ReactNode } from 'react';
import { Database, LayoutDashboard, Map as MapIcon, Menu, MessageSquare, Store, X, Rows3 } from 'lucide-react';
import { useApp, type Page } from './state/AppState';
import { cx, Spinner, Button, fmtDate } from './ui/components/ui';
import { AS_OF_DATE } from './config/rules';
import { OverviewPage } from './ui/pages/OverviewPage';
import { TerritoriesPage } from './ui/pages/TerritoriesPage';
import { ApplicantPage } from './ui/pages/ApplicantPage';
import { MapPage } from './ui/pages/MapPage';
import { AskPage } from './ui/pages/AskPage';
import { DataPanel } from './ui/components/DataPanel';
import { ApplicantDrawer } from './ui/applicant/ApplicantDrawer';

const NAV: { page: Page; label: string; icon: ReactNode; activeOn?: Page[] }[] = [
  { page: 'overview', label: 'Overview', icon: <LayoutDashboard size={18} /> },
  { page: 'territories', label: 'Applications', icon: <Rows3 size={18} />, activeOn: ['applicant'] },
  { page: 'map', label: 'Store network map', icon: <MapIcon size={18} /> },
  { page: 'ask', label: 'Ask StoreSense', icon: <MessageSquare size={18} /> },
];

const PAGES: Record<Page, () => ReactNode> = {
  overview: () => <OverviewPage />,
  territories: () => <TerritoriesPage />,
  applicant: () => <ApplicantPage />,
  map: () => <MapPage />,
  ask: () => <AskPage />,
};

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { page, setPage } = useApp();
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
          <Store size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-ink">StoreSense</p>
          <p className="text-xs leading-tight text-muted">Franchise expansion</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => {
          const active = page === n.page || n.activeOn?.includes(page);
          return (
            <li key={n.page}>
              <button
                onClick={() => {
                  setPage(n.page);
                  onNavigate?.();
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100 hover:text-ink',
                )}
              >
                {n.icon}
                {n.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-5 py-4 text-xs leading-relaxed text-muted">
        <p>StoreSense Eyewear (simulated brand)</p>
        <p title="A fixed date, so the same file always gives the same decisions">Rules dated {fmtDate(AS_OF_DATE)}</p>
      </div>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { parse, isSample, setDataPanelOpen } = useApp();
  return (
    <header className="sticky top-0 z-[500] flex items-center gap-3 border-b border-line bg-white px-4 py-2.5 lg:px-8">
      <button className="rounded-md p-1.5 text-muted hover:bg-gray-100 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1 truncate text-sm text-muted">
        {parse ? (
          <>
            Working on <span className="font-medium text-ink">{parse.source.fileName}</span>
            {isSample && <span className="ml-2 text-xs text-waitlist">(sample data)</span>}
          </>
        ) : (
          'No file loaded'
        )}
      </div>
      <Button size="sm" onClick={() => setDataPanelOpen(true)}>
        <Database size={14} /> Data &amp; CRM
      </Button>
    </header>
  );
}

export default function App() {
  const { page, status, error, loadSample } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-white lg:block">
        <Sidebar />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-[1000] lg:hidden">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white">
            <button className="absolute right-3 top-4 text-muted" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8">
            {status === 'loading' && !error && (
              <div className="py-24">
                <Spinner label="Reading applications and running the rules…" />
              </div>
            )}
            {status === 'error' && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-decline">
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
      <DataPanel />
      <ApplicantDrawer />
    </div>
  );
}
