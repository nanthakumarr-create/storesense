// Demand map: the "place" half of every decision. Where demand is, where stores are, where applicants want to open, where the gaps are.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Crosshair, Info, Layers as LayersIcon, MapPin, Store, Target, Users } from 'lucide-react';
import { useApp } from '../../state/AppState';
import { DECISIONS, type City, type Decision, type PinInfo, type Result } from '../../types';
import { CITY_TIER, OVERLAP_RADIUS_KM } from '../../config/rules';
import { demandIndexFor } from '../../engine/demand';
import { haversineKm } from '../../lib/geo';
import { EXISTING_STORES } from '../../data/existingStores';
import { Button, Card, CardHeader, DECISION_STYLE, EmptyState, PageHeader, Pill, Spinner, cx, fmtInt, fmtKm } from '../components/ui';
import { DemandMap, type Layers, type MapStore, type PinStat } from '../map/DemandMap';
import { CITIES, DEMAND_BINS, demandColor, demandLabel, loadPinShapes, type PinShapes } from '../map/mapData';

const LAYER_LABELS: { key: keyof Layers; label: string; swatch: ReactNode }[] = [
  { key: 'demand', label: 'Demand', swatch: <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-[#93d7cc] to-[#0b524c]" /> },
  { key: 'stores', label: 'Stores + radius', swatch: <span className="h-2.5 w-2.5 rounded-sm bg-slate-900" /> },
  { key: 'catchments', label: 'Catchments', swatch: <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-orange-700" /> },
  { key: 'applicants', label: 'Applicants', swatch: <span className="h-2.5 w-2.5 rounded-full bg-sky-700" /> },
  { key: 'redirects', label: 'Redirects', swatch: <span className="h-0.5 w-3 border-t-2 border-dashed border-violet-600" /> },
];

const isApproved = (d: Decision) => d === 'Approve' || d === 'Approve with conditions';

function resultCity(r: Result, pinCity: (pin: string) => string | undefined): string {
  return (r.pin && pinCity(r.pin)) || r.city;
}

export function MapPage() {
  const { output, parse, ctx, openApplicant, demandSource } = useApp();
  const [city, setCity] = useState<City>('Bengaluru');
  const [shapes, setShapes] = useState<PinShapes | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ demand: true, stores: true, catchments: false, applicants: true, redirects: true });
  const [decisionFilter, setDecisionFilter] = useState<Set<Decision>>(() => new Set(DECISIONS));
  const [hoverPin, setHoverPin] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [focusPin, setFocusPin] = useState<{ pin: string; nonce: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadPinShapes()
      .then((s) => alive && setShapes(s))
      .catch((e) => alive && setShapeError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setSelectedPin(null);
    setHoverPin(null);
  }, [city]);

  const pinIndex = useMemo<Record<string, PinInfo>>(() => Object.fromEntries((ctx?.pins ?? []).map((p) => [p.pin, p])), [ctx]);
  const cityPins = useMemo(() => (ctx?.pins ?? []).filter((p) => p.city === city), [ctx, city]);
  const results = output?.results ?? [];

  const stores = useMemo<MapStore[]>(() => {
    const list = parse?.stores?.length ? parse.stores : EXISTING_STORES;
    return list.flatMap((s) => {
      const c = ctx?.catchment.find((x) => x.store_id === s.id || x.pin === s.pin) ?? null;
      const p = pinIndex[s.pin];
      const pos = p ? { lat: p.lat, lng: p.lng } : c ? { lat: c.lat, lng: c.lng } : null;
      if (!pos) return [];
      const tier = CITY_TIER[s.city as City] ?? p?.tier ?? 'Tier 2';
      return [{ ...s, ...pos, tier, catchment: c }];
    });
  }, [parse, ctx, pinIndex]);

  const applicantsByPin = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of results) if (r.pin) m[r.pin] = (m[r.pin] ?? 0) + 1;
    return m;
  }, [results]);

  const pinStats = useMemo<Record<string, PinStat>>(() => {
    if (!ctx) return {};
    const out: Record<string, PinStat> = {};
    for (const p of cityPins) {
      const d = demandIndexFor(p.pin, ctx);
      let nearest: { id: string; km: number } | null = null;
      for (const s of stores) {
        const km = haversineKm(p, s);
        if (!nearest || km < nearest.km) nearest = { id: s.id, km };
      }
      out[p.pin] = {
        pin: p.pin,
        name: p.name,
        city: p.city,
        demandIndex: d.index,
        source: d.source,
        onlineOrders: d.onlineOrders,
        nearestStoreKm: nearest?.km ?? null,
        nearestStoreId: nearest?.id ?? null,
        applicants: applicantsByPin[p.pin] ?? 0,
      };
    }
    return out;
  }, [ctx, cityPins, stores, applicantsByPin]);

  const pinCity = (pin: string) => pinIndex[pin]?.city;
  const cityResults = useMemo(() => results.filter((r) => resultCity(r, pinCity) === city), [results, city, pinIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const cityStores = stores.filter((s) => s.city === city);
  const cityTerritories = (output?.territories ?? []).filter((t) => t.city === city);
  const slotsTotal = cityTerritories.reduce((a, t) => a + t.openSlots, 0);
  const slotsFilled = cityTerritories.reduce((a, t) => a + t.filled.length, 0);
  const approvedCount = cityResults.filter((r) => isApproved(r.decision)).length;
  const byDecision = useMemo(() => {
    const m = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<Decision, number>;
    for (const r of cityResults) m[r.decision]++;
    return m;
  }, [cityResults]);
  const offMap = cityResults.filter((r) => !r.pin || !pinIndex[r.pin]).length;

  const gaps = useMemo(() => (output?.gaps ?? []).filter((g) => g.city === city).sort((a, b) => b.demandIndex - a.demandIndex), [output, city]);

  const activePin = hoverPin ?? selectedPin;
  const active = activePin ? pinStats[activePin] : null;
  const tier = CITY_TIER[city];

  const flyTo = (pin: string) => {
    setSelectedPin(pin);
    setFocusPin({ pin, nonce: Date.now() });
  };
  const toggleDecision = (d: Decision) =>
    setDecisionFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  if (!ctx) {
    return (
      <>
        <PageHeader title="Demand map" />
        <Card className="p-10">
          <Spinner label="Loading pin and demand data…" />
        </Card>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Demand map"
        subtitle="Where customers are, where stores already serve them, and where applicants want to open."
        actions={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="map-city">
              City
            </label>
            <select
              id="map-city"
              value={city}
              onChange={(e) => setCity(e.target.value as City)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 md:hidden"
            >
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* City switcher (desktop) */}
      <div className="mb-3 hidden flex-wrap gap-1.5 md:flex">
        {CITIES.map((c) => {
          const n = results.filter((r) => resultCity(r, pinCity) === c).length;
          return (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                c === city ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-white text-ink hover:bg-slate-50',
              )}
            >
              {c}
              <span className={cx('tabular text-xs', c === city ? 'text-brand-100' : 'text-muted')}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Layer + decision filters */}
      <Card className="mb-3 px-3 py-2.5">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted">
              <LayersIcon size={13} /> Layers
            </span>
            {LAYER_LABELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLayers((s) => ({ ...s, [l.key]: !s[l.key] }))}
                aria-pressed={layers[l.key]}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                  layers[l.key] ? 'border-slate-300 bg-slate-100 text-ink' : 'border-line bg-white text-muted line-through decoration-slate-300',
                )}
              >
                {l.swatch}
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">Show</span>
            {DECISIONS.map((d) => {
              const on = decisionFilter.has(d);
              const st = DECISION_STYLE[d];
              return (
                <button
                  key={d}
                  onClick={() => toggleDecision(d)}
                  aria-pressed={on}
                  disabled={!layers.applicants}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-opacity disabled:opacity-40',
                    on ? cx(st.bg, st.text) : 'bg-white text-muted ring-line opacity-60',
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: on ? st.hex : '#cbd5e1' }} />
                  {st.short}
                  <span className="tabular">{byDecision[d]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Map */}
        <Card className="relative isolate h-[60vh] min-h-[360px] overflow-hidden lg:h-[calc(100vh-250px)] lg:min-h-[480px]">
          <DemandMap
            city={city}
            cityPins={cityPins}
            pinIndex={pinIndex}
            shapes={shapes}
            pinStats={pinStats}
            stores={stores}
            results={results}
            decisionFilter={decisionFilter}
            layers={layers}
            focusPin={focusPin}
            activePin={activePin}
            onHoverPin={setHoverPin}
            onSelectPin={setSelectedPin}
            onOpenApplicant={(uid) => openApplicant(uid)}
          />

          {/* Pin info card */}
          <div className="pointer-events-none absolute right-2 top-2 z-[1000] w-[min(240px,calc(100%-60px))]">
            {active ? (
              <div className="pointer-events-auto rounded-lg border border-line bg-white/95 p-3 text-xs shadow-md backdrop-blur">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="tabular text-sm font-semibold text-ink">{active.pin}</p>
                    <p className="truncate text-muted">{active.name}</p>
                  </div>
                  <span className="tabular rounded-md px-1.5 py-0.5 text-sm font-semibold text-white" style={{ background: demandColor(Math.max(active.demandIndex, 45)) }}>
                    {Math.round(active.demandIndex)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <dt className="text-muted">Demand index</dt>
                  <dd className="tabular text-right font-medium">{Math.round(active.demandIndex)} / 100</dd>
                  {active.onlineOrders !== null && (
                    <>
                      <dt className="text-muted">Online orders</dt>
                      <dd className="tabular text-right font-medium">{fmtInt(active.onlineOrders)}</dd>
                    </>
                  )}
                  <dt className="text-muted">Nearest store</dt>
                  <dd className="tabular text-right font-medium">
                    {active.nearestStoreKm !== null ? `${fmtKm(active.nearestStoreKm)} (${active.nearestStoreId})` : 'none in city'}
                  </dd>
                  <dt className="text-muted">Applicants here</dt>
                  <dd className="tabular text-right font-medium">{active.applicants}</dd>
                </dl>
                <p className="mt-2 text-[10px] text-muted">{active.source === 'orders' ? 'Simulated order data' : 'Demand proxy v1 (tier + centre)'}</p>
                {active.nearestStoreKm !== null && active.nearestStoreKm < OVERLAP_RADIUS_KM[tier] && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-waitlist">
                    <AlertTriangle size={11} /> Inside a store's {OVERLAP_RADIUS_KM[tier]} km overlap radius
                  </p>
                )}
              </div>
            ) : (
              <div className="pointer-events-auto hidden rounded-lg border border-line bg-white/90 px-3 py-2 text-[11px] text-muted shadow-sm sm:block">
                <Crosshair size={12} className="mr-1 inline" />
                Hover or tap a pin area for details
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="absolute bottom-6 left-2 z-[1000] max-w-[calc(100%-16px)] rounded-lg border border-line bg-white/95 p-2.5 text-[11px] shadow-md backdrop-blur">
            <p className="font-semibold text-ink">Demand index (0–100)</p>
            <p className="mb-1.5 text-muted">{demandLabel(city)}</p>
            <div className="flex">
              {DEMAND_BINS.map((b) => (
                <div key={b.min} className="flex w-7 flex-col items-start">
                  <span className="h-2.5 w-full" style={{ background: b.color }} />
                  <span className="tabular mt-0.5 text-[10px] text-muted">{b.min}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-900" /> Store ({OVERLAP_RADIUS_KM[tier]} km radius)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-orange-700" /> 80% of customers
              </span>
            </div>
          </div>

          {shapeError && (
            <div className="absolute inset-x-2 top-2 z-[1000] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-decline sm:right-auto">
              Pin boundaries could not load ({shapeError}). Stores and applicants are still shown.
            </div>
          )}
          {!shapes && !shapeError && layers.demand && (
            <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full border border-line bg-white px-3 py-1 shadow-sm">
              <Spinner label="Loading pin boundaries…" />
            </div>
          )}
        </Card>

        {/* Side panel */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title={`${city} at a glance`} subtitle={`${tier} · overlap radius ${OVERLAP_RADIUS_KM[tier]} km`} />
            <div className="grid grid-cols-2 gap-px bg-line">
              <MiniStat icon={<Users size={14} />} label="Applicants" value={cityResults.length} hint={offMap ? `${offMap} not on map (pin unknown)` : undefined} />
              <MiniStat icon={<Target size={14} />} label="Approved" value={approvedCount} hint={`${byDecision.Approve} now · ${byDecision['Approve with conditions']} conditional`} tone="good" />
              <MiniStat icon={<MapPin size={14} />} label="Slots" value={output ? `${slotsFilled} / ${slotsTotal}` : '—'} hint={`${cityTerritories.length} territor${cityTerritories.length === 1 ? 'y' : 'ies'}`} />
              <MiniStat icon={<Store size={14} />} label="Stores" value={cityStores.length} hint={cityStores.length ? cityStores.map((s) => s.id).join(', ') : 'Open market'} />
            </div>
            {cityResults.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                  {DECISIONS.map((d) =>
                    byDecision[d] ? <div key={d} title={`${d}: ${byDecision[d]}`} style={{ width: `${(byDecision[d] / cityResults.length) * 100}%`, background: DECISION_STYLE[d].hex }} /> : null,
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  {DECISIONS.filter((d) => byDecision[d]).map((d) => (
                    <span key={d} className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: DECISION_STYLE[d].hex }} />
                      {DECISION_STYLE[d].short} <span className="tabular text-ink">{byDecision[d]}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="flex min-h-0 flex-col lg:max-h-[calc(100vh-520px)] lg:min-h-[260px]">
            <CardHeader title="Top gaps" subtitle="High demand, no store close by. Click to fly there." action={gaps.length ? <Pill tone="brand">{gaps.length}</Pill> : undefined} />
            {!output ? (
              <div className="p-6">
                <Spinner label="Running the rules…" />
              </div>
            ) : gaps.length === 0 ? (
              <EmptyState
                icon={<Info size={28} />}
                title={`No open gaps in ${city}`}
                body={results.length ? 'Every high-demand pin here is within reach of a store or has an applicant.' : 'Gaps appear once decisions are ready.'}
              />
            ) : (
              <ul className="divide-y divide-line overflow-y-auto">
                {gaps.slice(0, 25).map((g, i) => (
                  <li key={g.pin}>
                    <button
                      onClick={() => flyTo(g.pin)}
                      className={cx('flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50', selectedPin === g.pin && 'bg-brand-50')}
                    >
                      <span className="tabular mt-0.5 w-4 shrink-0 text-xs text-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-ink">
                            <span className="tabular">{g.pin}</span> <span className="font-normal text-muted">{g.name}</span>
                          </p>
                          <span className="tabular shrink-0 text-sm font-semibold text-brand-700">{Math.round(g.demandIndex)}</span>
                        </div>
                        <p className="tabular mt-0.5 text-[11px] text-muted">
                          {fmtKm(g.nearestStoreKm)} to store
                          {g.onlineOrders !== null && <> · {fmtInt(g.onlineOrders)} online orders</>}
                          {' · '}
                          {g.applicants ? `${g.applicants} applicant${g.applicants > 1 ? 's' : ''}` : 'no applicants'}
                          {g.territoryId ? ` · ${g.territoryId}` : ' · no territory'}
                        </p>
                        {g.note && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{g.note}</p>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="px-1 text-[11px] leading-relaxed text-muted">
            Demand is {city === 'Bengaluru' ? 'simulated online-order data' : 'a rule-based proxy (tier base + bonus near the centre)'}; in production this is the brand's monthly
            orders-by-pin export. Orders source: {demandSource?.source === 'supabase' ? 'Supabase (live)' : 'bundled copy'}. Applicants sit at their pin's centre, spread
            slightly so people on the same pin don't overlap.
          </p>
          {selectedPin && (
            <Button size="sm" variant="ghost" onClick={() => setSelectedPin(null)} className="self-start">
              Clear selected pin
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; tone?: 'good' }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {icon}
        {label}
      </p>
      <p className={cx('tabular mt-1 text-xl font-semibold', tone === 'good' ? 'text-approve' : 'text-ink')}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted" title={hint}>{hint}</p>}
    </div>
  );
}
