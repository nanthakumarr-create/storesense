// Data & CRM: a right-side sheet (full screen on mobile) opened from the top bar.
// Upload / sample / template, HubSpot import and push, order-data source and the key assumptions.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../state/AppState';
import { ApplicationsSource, AssumptionsSection, HubSpotSection, OrderDataSection } from '../data/DataSections';

export function DataPanel() {
  const { dataPanelOpen, setDataPanelOpen, setPage } = useApp();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => setDataPanelOpen(false);

  useEffect(() => {
    if (!dataPanelOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDataPanelOpen(false);
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [dataPanelOpen, setDataPanelOpen]);

  if (!dataPanelOpen) return null;
  return (
    <div className="fixed inset-0 z-[1100]">
      <div className="absolute inset-0 bg-gray-900/30" onClick={close} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-panel-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-xl sm:max-w-[480px] sm:border-l sm:border-line"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="data-panel-title" className="text-base font-semibold text-ink">
              Data &amp; CRM
            </h2>
            <p className="mt-0.5 text-xs text-muted">Choose the applications to assess and where results go.</p>
          </div>
          <button ref={closeRef} onClick={close} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-gray-100 hover:text-ink">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <ApplicationsSource
            onDone={() => {
              close();
              setPage('territories');
            }}
          />
          <HubSpotSection open />
          <OrderDataSection />
          <AssumptionsSection />
        </div>
      </aside>
    </div>
  );
}
