// Store network map: where orders come from today, where we lose them, and what a new store would change.
// One mode at a time on a light basemap; click a store or pin to isolate it. Bengaluru has simulated order data.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../state/AppState';
import type { City, PinInfo, Result } from '../../types';
import { CITY_TIER, OVERLAP_RADIUS_KM } from '../../config/rules';
import { demandIndexFor, cityFromPin } from '../../engine/demand';
import { haversineKm } from '../../lib/geo';
import { storeSiteOf } from '../../lib/site';
import { EXISTING_STORES } from '../../data/existingStores';
import { PINS, PIN_BY_CODE } from '../../data/loaders';
import { Button, Card, DECISION_STYLE, PageHeader, Spinner, cx, fmtInt } from '../components/ui';
import { NetworkMap, type MapCircle, type MapLine, type PinPaint, type PointMarker, type StoreMarker } from '../map/NetworkMap';
import {
  BestPlaces,
  ImpactPanel,
  LeaksPanel,
  NetworkPanel,
  OtherCityPanel,
  PanelSection,
  PinTrafficPanel,
  StorePanel,
  type StoreShift,
} from '../map/MapPanels';
import {
  CITIES,
  DEMAND_INDEX_SCALE,
  FLOW_COLOR,
  HEAVY_LIFTER_PCT,
  LEAK_SCALE,
  OPPORTUNITY_SCALE,
  POTENTIAL_BY_PIN,
  TRAFFIC_SCALE,
  flowWeight,
  jitter,
  loadFlows,
  loadPinShapes,
  offsetSegment,
  scaleColor,
  storeArea,
  type FlowData,
  type PinShapes,
  type Scale,
} from '../map/mapData';

type Mode = 'traffic' | 'leaks' | 'plan';

const MODES: { id: Mode; label: string; what: string }[] = [
  { id: 'traffic', label: "Today's traffic", what: 'Where store orders come from today and which stores are near capacity. Click a store to isolate it.' },
  { id: 'leaks', label: 'Leaks', what: 'Where we lose orders because no store is close. Click a pin to see where its customers go instead.' },
  { id: 'plan', label: 'Plan a new store', what: 'Click any pin to see what a new store there would win, take from our stores, and earn.' },
];

const FEED_SCALE: Scale = { stops: [0, 3, 6, 12, 20, 35, 60], colors: TRAFFIC_SCALE.colors };
const DIM: Pick<PinPaint, 'fill' | 'opacity'> = { fill: '#e5e7eb', opacity: 0.12 };
const isApproved = (r: Result) => r.decision === 'Approve' || r.decision === 'Approve with conditions';
const ll = (p: { lat: number; lng: number }): [number, number] => [p.lat, p.lng];

export function MapPage() {
  const { output, parse, ctx, routeParam, openApplicant, page } = useApp();
  const [city, setCity] = useState<City>('Bengaluru');
  const [mode, setMode] = useState<Mode>('traffic');
  const [selStore, setSelStore] = useState<string | null>(null);
  const [selPin, setSelPin] = useState<string | null>(null);
  const [showApproved, setShowApproved] = useState(true);
  const [shapes, setShapes] = useState<PinShapes | null>(null);
  const [flows, setFlows] = useState<FlowData | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number; nonce: string } | null>(null);

  const blr = city === 'Bengaluru';

  useEffect(() => {
    loadPinShapes().then(setShapes).catch(() => setShapes(null)); // dots fallback if boundaries fail
  }, []);
  const fetchFlows = useCallback(() => {
    setFlowError(null);
    loadFlows()
      .then(setFlows)
      .catch((e: unknown) => setFlowError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(fetchFlows, [fetchFlows]);

  const flyTo = useCallback((pin: string, zoom = 12) => {
    const p = PIN_BY_CODE[pin];
    if (p) setFocus({ lat: p.lat, lng: p.lng, zoom, nonce: `${pin}-${Date.now()}` });
  }, []);

  // Deep link: #/map/560010 → simulate a store there (Bengaluru) or focus the pin (other cities).
  useEffect(() => {
    if (page !== 'map' || !routeParam || !/^\d{6}$/.test(routeParam)) return;
    const c = cityFromPin(routeParam);
    if (!c) return;
    setCity(c);
    setSelStore(null);
    setSelPin(routeParam);
    setMode(c === 'Bengaluru' ? 'plan' : 'traffic');
    flyTo(routeParam, 12);
  }, [routeParam, page, flyTo]);

  const cityPins = useMemo(() => PINS.filter((p) => p.city === city), [city]);
  const pinName = useCallback((pin: string) => PIN_BY_CODE[pin]?.name ?? '', []);
  const tier = CITY_TIER[city];
  const overlapKm = OVERLAP_RADIUS_KM[tier];

  const cityStores = useMemo(() => {
    const list = parse?.stores?.length ? parse.stores : EXISTING_STORES;
    return list
      .filter((s) => s.city === city || cityFromPin(s.pin) === city)
      .map((s) => {
        const fs = flows?.stores.find((x) => x.id === s.id);
        const p = PIN_BY_CODE[s.pin];
        const pos = fs ? { lat: fs.lat, lng: fs.lng } : p ? { lat: p.lat, lng: p.lng } : null;
        return pos ? { ...s, ...pos, flow: fs ?? null } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [parse, city, flows]);

  // One marker per approved store, at the pin where it will open (an allocated pair shares one site)
  const approved = useMemo(() => {
    if (!output) return [] as (Result & { site: string })[];
    const seenPairs = new Set<string>();
    return output.results
      .filter((r) => isApproved(r))
      .filter((r) => {
        if (r.partnership?.status !== 'allocated') return true;
        if (seenPairs.has(r.partnership.id)) return false;
        seenPairs.add(r.partnership.id);
        return true;
      })
      .map((r) => ({ ...r, site: storeSiteOf(r, output) ?? '' }))
      .filter((r) => r.site && PIN_BY_CODE[r.site]?.city === city);
  }, [output, city]);

  const candidate = blr && mode === 'plan' && selPin && flows ? flows.candidates[selPin] ?? null : null;
  const pot = blr && mode === 'plan' && selPin ? POTENTIAL_BY_PIN[selPin] ?? null : null;

  // Bengaluru opens zoomed on the store cluster so labels don't collide; other cities fit all their pins.
  const fitTo = useMemo<[number, number][] | null>(() => (blr && cityStores.length > 1 ? cityStores.map(ll) : null), [blr, cityStores.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- pin shading ---------- */
  const paint = useMemo<Record<string, PinPaint>>(() => {
    const out: Record<string, PinPaint> = {};
    for (const p of cityPins) {
      const name = `${p.pin} ${p.name}`;
      const emphasis = p.pin === selPin;
      if (!blr) {
        const d = ctx ? demandIndexFor(p.pin, ctx).index : 0;
        out[p.pin] = { fill: scaleColor(DEMAND_INDEX_SCALE, d), opacity: 0.6, emphasis, label: `${name} · demand proxy ${d}/100` };
        continue;
      }
      if (!flows) {
        out[p.pin] = { fill: '#f3f4f6', opacity: 0.4, label: name };
        continue;
      }
      const fp = flows.pins[p.pin];
      const pp = POTENTIAL_BY_PIN[p.pin];
      if (mode === 'traffic') {
        if (selStore) {
          const v = flows.baseline.find((b) => b.pin === p.pin && b.store === selStore)?.perMonth ?? 0;
          out[p.pin] = v > 0 ? { fill: scaleColor(FEED_SCALE, v), opacity: 0.75, label: `${name} · ${v} orders/mo to ${selStore}` } : { ...DIM, label: `${name} · no orders to ${selStore}` };
        } else {
          const v = fp ? fp.store + fp.online : 0;
          out[p.pin] = {
            fill: scaleColor(TRAFFIC_SCALE, v),
            opacity: selPin && !emphasis ? 0.3 : 0.6,
            emphasis,
            label: fp ? `${name} · ${v} orders/mo (${fp.store} in store, ${fp.online} online)` : `${name} · no order data`,
          };
        }
      } else if (mode === 'leaks') {
        const v = pp?.missed_orders_month ?? 0;
        out[p.pin] = {
          fill: scaleColor(LEAK_SCALE, v),
          opacity: selPin && !emphasis ? 0.35 : 0.72,
          emphasis,
          label: pp ? `${name} · ${v} missed orders/mo (₹${pp.missed_sales_lakh_month.toFixed(2)}L) · ${pp.redirected_orders_month} travel >4 km` : name,
        };
      } else if (candidate) {
        const f = candidate.flows.find((x) => x.pin === p.pin);
        const v = f ? f.takenPerMonth + f.newPerMonth : 0;
        out[p.pin] = v > 0 || emphasis
          ? { fill: scaleColor(FEED_SCALE, v), opacity: 0.75, emphasis, label: f ? `${name} · ${f.newPerMonth} new + ${f.takenPerMonth} from ${f.fromStore} per month` : name }
          : { ...DIM, label: `${name} · not in this store's catchment` };
      } else {
        const existing = pp?.verdict === 'Existing store here';
        const v = existing ? 0 : pp?.incremental_orders_month ?? 0;
        out[p.pin] = {
          fill: existing ? '#d1d5db' : scaleColor(OPPORTUNITY_SCALE, v),
          opacity: 0.72,
          emphasis,
          label: !pp ? name : existing ? `${name} · existing store` : `${name} · +${v} new orders/mo · payback ${pp.payback_months ?? '—'} mo`,
        };
      }
    }
    return out;
  }, [cityPins, blr, ctx, flows, mode, selStore, selPin, candidate]);

  /* ---------- lines (only for the current selection, except a light leak overview) ---------- */
  const lines = useMemo<MapLine[]>(() => {
    if (!blr || !flows) return [];
    const storePos = Object.fromEntries(flows.stores.map((s) => [s.id, ll(s)]));
    const pinPos = (pin: string) => (PIN_BY_CODE[pin] ? ll(PIN_BY_CODE[pin]) : null);
    const out: MapLine[] = [];
    if (mode === 'traffic') {
      const rows = selStore ? flows.baseline.filter((b) => b.store === selStore) : selPin ? flows.baseline.filter((b) => b.pin === selPin) : [];
      for (const b of rows) {
        const a = pinPos(b.pin);
        if (!a || !storePos[b.store] || b.perMonth <= 0) continue;
        out.push({ key: `t-${b.pin}-${b.store}`, positions: [a, storePos[b.store]], color: FLOW_COLOR.today, weight: flowWeight(b.perMonth), opacity: 0.5, tooltip: `${b.pin} ${pinName(b.pin)} → ${b.store}: ${b.perMonth} orders/mo` });
      }
    } else if (mode === 'leaks') {
      const src = selPin ? [POTENTIAL_BY_PIN[selPin]].filter(Boolean) : Object.values(POTENTIAL_BY_PIN);
      for (const p of src) {
        for (const r of p.redirected_to) {
          if (r.ordersPerMonth < (selPin ? 1 : 4) || !storePos[r.store]) continue;
          out.push({
            key: `l-${p.pin}-${r.store}`,
            positions: [ll(p), storePos[r.store]],
            color: FLOW_COLOR.redirect,
            weight: selPin ? flowWeight(r.ordersPerMonth) + 1 : 1.2,
            opacity: selPin ? 0.85 : 0.35,
            tooltip: `${p.pin} ${p.name} → ${r.store}: ${r.ordersPerMonth} orders/mo travel more than 4 km`,
          });
        }
      }
    } else if (candidate && selPin && PIN_BY_CODE[selPin]) {
      const target = ll(PIN_BY_CODE[selPin]);
      const top = [...candidate.flows].sort((a, b) => b.takenPerMonth + b.newPerMonth - (a.takenPerMonth + a.newPerMonth)).slice(0, 30);
      for (const f of top) {
        const a = pinPos(f.pin);
        if (!a || f.takenPerMonth + f.newPerMonth < 2 || f.pin === selPin) continue;
        if (f.takenPerMonth >= 5 && storePos[f.fromStore]) {
          out.push({ key: `o-${f.pin}`, positions: [a, storePos[f.fromStore]], color: FLOW_COLOR.oldRoute, weight: 1.5, opacity: 0.6, dash: '4 6', tooltip: `Today: ${f.pin} ${pinName(f.pin)} → ${f.fromStore}` });
        }
        const both = f.takenPerMonth > 0 && f.newPerMonth > 0;
        if (f.takenPerMonth > 0) {
          out.push({ key: `k-${f.pin}`, positions: both ? offsetSegment(a, target, 70) : [a, target], color: FLOW_COLOR.taken, weight: flowWeight(f.takenPerMonth), tooltip: `${f.pin} ${pinName(f.pin)}: ${f.takenPerMonth} orders/mo move from ${f.fromStore} to the new store` });
        }
        if (f.newPerMonth > 0) {
          out.push({ key: `n-${f.pin}`, positions: both ? offsetSegment(a, target, -70) : [a, target], color: FLOW_COLOR.won, weight: flowWeight(f.newPerMonth), tooltip: `${f.pin} ${pinName(f.pin)}: ${f.newPerMonth} new orders/mo won back (online or missed today)` });
        }
      }
    }
    return out;
  }, [blr, flows, mode, selStore, selPin, candidate, pinName]);

  /* ---------- circles: overlap radius + catchments ---------- */
  const circles = useMemo<MapCircle[]>(() => {
    const out: MapCircle[] = [];
    const isolated = blr && mode === 'traffic' && selStore;
    for (const s of cityStores) {
      if (isolated && s.id !== selStore) continue;
      const strong = isolated && s.id === selStore;
      out.push({ key: `ov-${s.id}`, center: ll(s), radiusM: overlapKm * 1000, color: '#111827', fillOpacity: strong ? 0.08 : 0.04, dash: strong ? undefined : '2 4' });
      if (strong) {
        const c = ctx?.catchment.find((x) => x.store_id === s.id);
        if (c) out.push({ key: `p80-${s.id}`, center: ll(s), radiusM: c.p80_customer_km * 1000, color: FLOW_COLOR.today, dash: '8 6' });
      }
    }
    if (candidate && selPin && PIN_BY_CODE[selPin]) {
      const c = ll(PIN_BY_CODE[selPin]);
      out.push({ key: 'new-ov', center: c, radiusM: overlapKm * 1000, color: '#1d4ed8', fillOpacity: 0.1 });
      out.push({ key: 'new-catch', center: c, radiusM: candidate.catchment_radius_km * 1000, color: '#1d4ed8', dash: '8 6' });
    }
    return out;
  }, [cityStores, blr, mode, selStore, overlapKm, ctx, candidate, selPin]);

  /* ---------- store markers ---------- */
  const storeMarkers = useMemo<StoreMarker[]>(
    () =>
      cityStores.map((s) => {
        const f = s.flow;
        const area = storeArea(s.id, f?.area ?? s.city);
        if (!f) {
          return { id: s.id, lat: s.lat, lng: s.lng, pct: null, heavy: false, dimmed: false, selected: false, caption: s.id, tooltip: `${s.id} · pin ${s.pin} · opened ${s.opened} · no order data`, size: 20 };
        }
        const after = candidate ? candidate.store_load_after[s.id] : undefined;
        const afterPct = after !== undefined ? Math.round((after / f.capacity_per_month) * 100) : null;
        const changed = afterPct !== null && afterPct !== f.utilisation_pct;
        const heavy = f.utilisation_pct >= HEAVY_LIFTER_PCT;
        return {
          id: s.id,
          lat: s.lat,
          lng: s.lng,
          pct: changed ? afterPct : f.utilisation_pct,
          heavy: changed ? (afterPct ?? 0) >= HEAVY_LIFTER_PCT : heavy,
          dimmed: (mode === 'traffic' && !!selStore && selStore !== s.id) || (!!candidate && !changed),
          selected: selStore === s.id,
          caption: changed ? `${s.id} · ${f.utilisation_pct}→${afterPct}%` : `${s.id} · ${f.utilisation_pct}%`,
          tooltip: `${s.id} ${area} · ${fmtInt(f.load_per_month)} orders/mo · ${f.utilisation_pct}% of capacity${heavy ? ' · heavy lifter' : ''}${changed ? ` · after new store: ${afterPct}%` : ''}`,
          size: Math.round(22 + (f.load_per_month / f.capacity_per_month) * 16),
        };
      }),
    [cityStores, candidate, mode, selStore],
  );

  const points = useMemo<PointMarker[]>(
    () =>
      showApproved
        ? approved.map((r) => {
            const p = PIN_BY_CODE[r.site] as PinInfo;
            const who = r.partnership?.status === 'allocated' ? `${r.appId} + ${r.partnership.withAppId} (pair)` : `${r.appId} ${r.name}`;
            return {
              key: r.uid,
              pos: jitter(p.lat, p.lng, r.uid),
              color: DECISION_STYLE[r.decision].hex,
              radius: 6,
              tooltip: `${who} · ${r.decision} · pin ${r.site}`,
              onClick: () => openApplicant(r.uid),
            };
          })
        : [],
    [showApproved, approved, openApplicant],
  );

  /* ---------- interactions ---------- */
  const changeMode = (m: Mode) => {
    setMode(m);
    setSelStore(null);
    setSelPin(null);
  };
  const onPinClick = useCallback(
    (pin: string) => {
      setSelStore(null);
      setSelPin((cur) => (cur === pin && mode !== 'plan' ? null : pin));
    },
    [mode],
  );
  const onStoreClick = useCallback(
    (id: string) => {
      if (!blr) return;
      setMode('traffic');
      setSelPin(null);
      setSelStore((cur) => (cur === id ? null : id));
    },
    [blr],
  );
  const selectStoreFromList = (id: string) => {
    setSelStore(id);
    setSelPin(null);
    const s = cityStores.find((x) => x.id === id);
    if (s) setFocus({ lat: s.lat, lng: s.lng, zoom: 12, nonce: `${id}-${Date.now()}` });
  };
  const simulateAt = (pin: string) => {
    setMode('plan');
    setSelStore(null);
    setSelPin(pin);
    flyTo(pin, 12);
  };
  const pickPin = (pin: string | null) => {
    setSelPin(pin);
    if (pin) flyTo(pin, 13);
  };

  /* ---------- plan-mode data ---------- */
  const shifts = useMemo<StoreShift[]>(() => {
    if (!candidate || !flows) return [];
    return flows.stores
      .map((s) => ({ id: s.id, area: storeArea(s.id, s.area), before: s.load_per_month, after: candidate.store_load_after[s.id] ?? s.load_per_month, capacity: s.capacity_per_month }))
      .sort((a, b) => b.before - b.after - (a.before - a.after) || a.id.localeCompare(b.id));
  }, [candidate, flows]);

  const planApplicants = useMemo(() => {
    if (!selPin || !output) return { list: [] as Result[], territory: null as string | null, heldBy: null as string | null };
    const terr = parse?.territories.find((t) => t.pins.includes(selPin)) ?? null;
    const list = output.results
      .filter((r) => r.pin === selPin || (terr && r.territoryId === terr.id))
      .sort((a, b) => Number(b.pin === selPin) - Number(a.pin === selPin) || b.combinedScore - a.combinedScore)
      .slice(0, 10);
    const holder = output.results.find((r) => isApproved(r) && storeSiteOf(r, output) === selPin);
    return {
      list,
      territory: terr ? `${terr.id} · ${terr.priority} priority · ${terr.openSlots} open slot${terr.openSlots === 1 ? '' : 's'}` : null,
      heldBy: holder ? `${holder.appId} ${holder.name}` : null,
    };
  }, [selPin, output, parse]);

  /* ---------- other-city data ---------- */
  const otherCity = useMemo(() => {
    if (blr || !ctx) return null;
    const nearest = (p: PinInfo) => {
      let best: { id: string; km: number } | null = null;
      for (const s of cityStores) {
        const km = haversineKm(p, s);
        if (!best || km < best.km) best = { id: s.id, km };
      }
      return best;
    };
    const rows = cityPins.map((p) => ({ p, index: demandIndexFor(p.pin, ctx).index, near: nearest(p) }));
    const topPins = [...rows]
      .sort((a, b) => b.index - a.index || (b.near?.km ?? 99) - (a.near?.km ?? 99))
      .slice(0, 8)
      .map((r) => ({ pin: r.p.pin, name: r.p.name, index: r.index, nearestKm: r.near ? r.near.km : null }));
    const sel = selPin ? rows.find((r) => r.p.pin === selPin) : null;
    return {
      topPins,
      pinDetail: sel
        ? { pin: sel.p.pin, name: sel.p.name, index: sel.index, nearestStore: sel.near?.id ?? null, nearestKm: sel.near?.km ?? null, applicants: (output?.results ?? []).filter((r) => r.pin === sel.p.pin) }
        : null,
    };
  }, [blr, ctx, cityPins, cityStores, selPin, output]);

  /* ---------- panel ---------- */
  let panel: ReactNode;
  if (!blr) {
    panel = otherCity ? (
      <OtherCityPanel
        city={city}
        stores={cityStores.map((s) => ({ id: s.id, pin: s.pin, opened: s.opened, overlapKm }))}
        topPins={otherCity.topPins}
        selectedPin={selPin}
        pinDetail={otherCity.pinDetail}
        approved={approved}
        onPin={pickPin}
        onOpenApplicant={openApplicant}
      />
    ) : (
      <div className="p-6">
        <Spinner label="Loading demand data…" />
      </div>
    );
  } else if (flowError) {
    panel = (
      <PanelSection title="Could not load order flows">
        <p className="text-sm text-muted">{flowError}</p>
        <Button className="mt-3" onClick={fetchFlows}>
          Try again
        </Button>
      </PanelSection>
    );
  } else if (!flows) {
    panel = (
      <div className="p-6">
        <Spinner label="Loading order flows…" />
      </div>
    );
  } else if (mode === 'traffic') {
    panel = selStore ? (
      <StorePanel
        flows={flows}
        storeId={selStore}
        catchment={ctx?.catchment.find((c) => c.store_id === selStore) ?? null}
        overlapKm={overlapKm}
        pinName={pinName}
        onBack={() => setSelStore(null)}
        onPin={(pin) => {
          setSelStore(null);
          pickPin(pin);
        }}
      />
    ) : selPin ? (
      <PinTrafficPanel flows={flows} pin={selPin} pinName={pinName(selPin)} onBack={() => setSelPin(null)} onSimulate={() => simulateAt(selPin)} />
    ) : (
      <NetworkPanel flows={flows} selectStore={selectStoreFromList} />
    );
  } else if (mode === 'leaks') {
    panel = <LeaksPanel flows={flows} selectedPin={selPin} onPin={pickPin} onSimulate={simulateAt} />;
  } else {
    panel = (
      <>
        {selPin && pot ? (
          <ImpactPanel
            pot={pot}
            radiusKm={candidate?.catchment_radius_km ?? null}
            shifts={shifts}
            applicants={planApplicants.list}
            territoryLabel={planApplicants.territory}
            heldBy={planApplicants.heldBy}
            meta={flows.meta}
            onOpenApplicant={openApplicant}
            onClear={() => setSelPin(null)}
          />
        ) : selPin ? (
          <PanelSection title={`${selPin} ${pinName(selPin)}`}>
            <p className="text-sm text-muted">No order data for this pin, so a new store cannot be simulated here.</p>
          </PanelSection>
        ) : (
          <PanelSection title="Pick a place">
            <p className="text-sm text-ink">Click any pin on the map, or choose one of the best places below.</p>
          </PanelSection>
        )}
        <BestPlaces selectedPin={selPin} onPick={simulateAt} />
      </>
    );
  }

  const modeInfo = MODES.find((m) => m.id === mode)!;

  return (
    <div>
      <PageHeader
        title="Store network map"
        subtitle="See where orders come from, where we lose them, and what a new franchise would change."
        actions={
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value as City);
              setSelPin(null);
              setSelStore(null);
            }}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
            aria-label="City"
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        }
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full rounded-lg border border-line bg-white p-0.5 sm:w-auto" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              disabled={!blr && m.id !== 'traffic'}
              onClick={() => changeMode(m.id)}
              className={cx(
                'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none',
                mode === m.id ? 'bg-brand-700 font-medium text-white' : 'text-muted hover:text-ink',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showApproved} onChange={(e) => setShowApproved(e.target.checked)} className="h-4 w-4 accent-brand-700" />
          Show approved franchises ({approved.length})
        </label>
      </div>
      <p className="mb-3 text-sm text-ink">{blr ? modeInfo.what : `${city}: stores and a demand proxy only. Order data and traffic simulation cover Bengaluru.`}</p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <Card className="relative isolate h-[55vh] overflow-hidden lg:h-[calc(100vh-240px)] lg:min-h-[480px]">
            <NetworkMap
              city={city}
              cityPins={cityPins}
              shapes={shapes}
              paint={paint}
              lines={lines}
              circles={circles}
              stores={storeMarkers}
              points={points}
              newStore={candidate && selPin && PIN_BY_CODE[selPin] ? { ...PIN_BY_CODE[selPin], label: `New store · ${selPin}` } : null}
              focus={focus}
              fitTo={fitTo}
              onPinClick={onPinClick}
              onStoreClick={onStoreClick}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] hidden sm:block">
              <Legend mode={blr ? mode : 'proxy'} isolated={!!selStore} planning={!!candidate} overlapKm={overlapKm} />
            </div>
          </Card>
          <div className="mt-2 sm:hidden">
            <Legend mode={blr ? mode : 'proxy'} isolated={!!selStore} planning={!!candidate} overlapKm={overlapKm} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {blr
              ? `Simulated online and store orders${flows ? `, ${flows.meta.window}` : ''}, scaled so today's stores match the Tier 1 sales assumption. Not live data.`
              : 'Demand proxy = rulebook tier base + bonus near the city centre. Not order data.'}
          </p>
        </div>
        <Card className="h-fit overflow-hidden lg:max-h-[calc(100vh-240px)] lg:min-h-[480px] lg:overflow-y-auto">{panel}</Card>
      </div>
    </div>
  );
}

/* ---------------- Legend ---------------- */

function Ramp({ scale, low, high }: { scale: Scale; low: string; high: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted">{low}</span>
      <span className="flex h-2 w-24 overflow-hidden rounded-sm">
        {scale.colors.map((c) => (
          <span key={c} className="flex-1" style={{ background: c }} />
        ))}
      </span>
      <span className="text-muted">{high}</span>
    </div>
  );
}

function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-5 justify-center">{swatch}</span>
      <span>{children}</span>
    </div>
  );
}

const line = (color: string, dashed = false) => <span className="w-5" style={{ borderTop: `${dashed ? 2 : 3}px ${dashed ? 'dashed' : 'solid'} ${color}` }} />;
const ring = (color: string) => <span className="h-3 w-3 rounded-full" style={{ border: `3px solid ${color}`, background: '#111827' }} />;

function Legend({ mode, isolated, planning, overlapKm }: { mode: Mode | 'proxy'; isolated: boolean; planning: boolean; overlapKm: number }) {
  return (
    <div className="space-y-1 rounded-lg border border-line bg-white/95 px-3 py-2 text-[11px] text-ink shadow-sm">
      {mode === 'traffic' && (
        <>
          <p className="font-medium">{isolated ? 'Orders per month to this store' : 'Orders per month per pin (store + online)'}</p>
          <Ramp scale={isolated ? FEED_SCALE : TRAFFIC_SCALE} low="few" high="many" />
          <Key swatch={ring('#1d4ed8')}>Store, ring = load vs capacity</Key>
          <Key swatch={ring('#b91c1c')}>Heavy lifter (75%+ of capacity)</Key>
          {isolated && <Key swatch={line(FLOW_COLOR.today)}>Customer flow, width = orders</Key>}
          {isolated && <Key swatch={line(FLOW_COLOR.today, true)}>80% of customers live inside</Key>}
          <Key swatch={<span className="h-3 w-3 rounded-full border border-dashed border-gray-900 bg-gray-900/10" />}>{overlapKm} km overlap radius</Key>
        </>
      )}
      {mode === 'leaks' && (
        <>
          <p className="font-medium">Missed orders per month per pin</p>
          <Ramp scale={LEAK_SCALE} low="few" high="many" />
          <Key swatch={line(FLOW_COLOR.redirect)}>Orders travelling more than 4 km</Key>
        </>
      )}
      {mode === 'plan' && !planning && (
        <>
          <p className="font-medium">New orders per month a store here would win</p>
          <Ramp scale={OPPORTUNITY_SCALE} low="few" high="many" />
          <Key swatch={<span className="h-3 w-3 rounded-sm bg-gray-300" />}>Existing store pin</Key>
        </>
      )}
      {mode === 'plan' && planning && (
        <>
          <p className="font-medium">If a store opens at the blue marker</p>
          <Key swatch={line(FLOW_COLOR.won)}>New orders won back</Key>
          <Key swatch={line(FLOW_COLOR.taken)}>Orders taken from our stores</Key>
          <Key swatch={line(FLOW_COLOR.oldRoute, true)}>Today's route (before)</Key>
          <Key swatch={<span className="h-3 w-3 rounded-full border-2 border-dashed border-brand-700" />}>Catchment radius</Key>
        </>
      )}
      {mode === 'proxy' && (
        <>
          <p className="font-medium">Demand proxy (0-100)</p>
          <Ramp scale={DEMAND_INDEX_SCALE} low="low" high="high" />
          <Key swatch={ring('#111827')}>Existing store</Key>
          <Key swatch={<span className="h-3 w-3 rounded-full border border-dashed border-gray-900 bg-gray-900/10" />}>{overlapKm} km overlap radius</Key>
        </>
      )}
      <Key swatch={<span className="h-2.5 w-2.5 rounded-full border border-white" style={{ background: DECISION_STYLE.Approve.hex }} />}>Approved franchise</Key>
    </div>
  );
}
