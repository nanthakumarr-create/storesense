// The Leaflet map: demand choropleth, existing stores with overlap radius + catchment, applicants by decision, redirect lines.
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Feature, Geometry } from 'geojson';
import type { Decision, ExistingStore, PinInfo, Result, StoreCatchment, Tier } from '../../types';
import { CITY_CENTRE, OVERLAP_RADIUS_KM } from '../../config/rules';
import { DECISION_STYLE, fmtInt, fmtKm } from '../components/ui';
import { demandColor, jitter, type PinShapeProps, type PinShapes } from './mapData';

export interface PinStat {
  pin: string;
  name: string;
  city: string;
  demandIndex: number;
  source: 'orders' | 'proxy';
  onlineOrders: number | null;
  nearestStoreKm: number | null;
  nearestStoreId: string | null;
  applicants: number;
}

export interface Layers {
  demand: boolean;
  stores: boolean;
  catchments: boolean;
  applicants: boolean;
  redirects: boolean;
}

export interface MapStore extends ExistingStore {
  lat: number;
  lng: number;
  tier: Tier;
  catchment: StoreCatchment | null;
}

interface Props {
  city: string;
  cityPins: PinInfo[];
  pinIndex: Record<string, PinInfo>;
  shapes: PinShapes | null;
  pinStats: Record<string, PinStat>;
  stores: MapStore[];
  results: Result[];
  decisionFilter: Set<Decision>;
  layers: Layers;
  focusPin: { pin: string; nonce: number } | null;
  activePin: string | null;
  onHoverPin: (pin: string | null) => void;
  onSelectPin: (pin: string) => void;
  onOpenApplicant: (uid: string) => void;
}

const STORE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20v3a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0Z"/></svg>';

function storeIcon(id: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
    html: `<div title="${id}" style="width:26px;height:26px;border-radius:7px;background:#0f172a;border:2px solid #fff;box-shadow:0 1px 4px rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center">${STORE_SVG}</div>`,
  });
}

/** Fit the map to the selected city's pins whenever the city changes. */
function FitCity({ city, cityPins }: { city: string; cityPins: PinInfo[] }) {
  const map = useMap();
  useEffect(() => {
    if (cityPins.length) {
      const b = L.latLngBounds(cityPins.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b.pad(0.08), { animate: true, maxZoom: 13 });
    } else {
      const c = CITY_CENTRE[city as keyof typeof CITY_CENTRE];
      if (c) map.setView([c.lat, c.lng], 12);
    }
  }, [city, cityPins, map]);
  return null;
}

function FlyTo({ focus, pinIndex }: { focus: Props['focusPin']; pinIndex: Record<string, PinInfo> }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const p = pinIndex[focus.pin];
    if (p) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [focus, pinIndex, map]);
  return null;
}

/** Leaflet measures its container once; re-measure when the layout settles (mobile stack / sidebar). */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function DemandLayer({ shapes, city, pinStats, activePin, onHoverPin, onSelectPin }: Pick<Props, 'shapes' | 'city' | 'pinStats' | 'activePin' | 'onHoverPin' | 'onSelectPin'>) {
  const ref = useRef<L.GeoJSON | null>(null);
  const handlers = useRef({ onHoverPin, onSelectPin });
  handlers.current = { onHoverPin, onSelectPin };

  const data = useMemo(() => (shapes ? { ...shapes, features: shapes.features.filter((f) => f.properties.city === city) } : null), [shapes, city]);

  const styleFor = (pin: string, active: boolean): L.PathOptions => {
    const s = pinStats[pin];
    return {
      fillColor: s ? demandColor(s.demandIndex) : '#f1f5f9',
      fillOpacity: active ? 0.88 : 0.72,
      color: active ? '#0f172a' : '#ffffff',
      weight: active ? 2.2 : 0.8,
    };
  };

  // Restyle in place when the active pin or stats change (no layer rebuild).
  useEffect(() => {
    ref.current?.eachLayer((l) => {
      const f = (l as L.Path & { feature?: Feature<Geometry, PinShapeProps> }).feature;
      if (f) (l as L.Path).setStyle(styleFor(f.properties.pin, f.properties.pin === activePin));
    });
  });

  if (!data) return null;
  return (
    <GeoJSON
      key={city}
      ref={ref}
      data={data}
      style={(f) => styleFor((f?.properties as PinShapeProps).pin, (f?.properties as PinShapeProps).pin === activePin)}
      onEachFeature={(f, layer) => {
        const pin = (f.properties as PinShapeProps).pin;
        layer.on({
          mouseover: () => handlers.current.onHoverPin(pin),
          mouseout: () => handlers.current.onHoverPin(null),
          click: () => handlers.current.onSelectPin(pin),
        });
      }}
    />
  );
}

function StorePopup({ s }: { s: MapStore }) {
  const c = s.catchment;
  return (
    <div className="min-w-[200px] text-xs text-ink">
      <p className="text-sm font-semibold">
        {s.id} · {c?.area && c.area !== s.city ? c.area : s.city}
      </p>
      <p className="text-muted">
        Pin {s.pin} · opened {s.opened} · overlap radius {OVERLAP_RADIUS_KM[s.tier]} km
      </p>
      {c ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-muted">Store orders</span>
            <span className="tabular text-right font-medium">{fmtInt(c.store_orders)}</span>
            <span className="text-muted">Avg customer distance</span>
            <span className="tabular text-right font-medium">{fmtKm(c.avg_customer_km)}</span>
            <span className="text-muted">80% of customers within</span>
            <span className="tabular text-right font-medium">{fmtKm(c.p80_customer_km)}</span>
            <span className="text-muted">Pins served</span>
            <span className="tabular text-right font-medium">{c.pins_served}</span>
          </div>
          {c.top_source_pins.length > 0 && (
            <div className="mt-2 border-t border-line pt-1.5">
              <p className="mb-0.5 font-medium text-muted">Top source pins</p>
              {c.top_source_pins.slice(0, 4).map((t) => (
                <div key={t.pin} className="flex justify-between gap-2">
                  <span className="truncate">
                    {t.pin} {t.name}
                  </span>
                  <span className="tabular">{fmtInt(t.orders)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-muted">Simulated order data</p>
        </>
      ) : (
        <p className="mt-1.5 text-muted">No catchment data for this store (order data covers Bengaluru only).</p>
      )}
    </div>
  );
}

export function DemandMap(props: Props) {
  const { city, cityPins, pinIndex, shapes, pinStats, stores, results, decisionFilter, layers, focusPin, activePin } = props;
  const centre = CITY_CENTRE[city as keyof typeof CITY_CENTRE] ?? CITY_CENTRE.Bengaluru;

  const placed = useMemo(
    () =>
      results
        .filter((r) => decisionFilter.has(r.decision) && r.pin && pinIndex[r.pin])
        .map((r) => {
          const p = pinIndex[r.pin as string];
          return { r, pos: jitter(p.lat, p.lng, r.uid) };
        }),
    [results, decisionFilter, pinIndex],
  );

  const approved = placed.filter((x) => x.r.decision === 'Approve' || x.r.decision === 'Approve with conditions');
  const redirects = results.filter((r) => r.decision === 'Redirect' && r.redirect && r.pin && pinIndex[r.pin] && pinIndex[r.redirect.pin]);
  const storeIcons = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, storeIcon(s.id)])), [stores]);

  return (
    <MapContainer center={[centre.lat, centre.lng]} zoom={11} minZoom={7} maxZoom={17} scrollWheelZoom className="h-full w-full" zoomControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitCity city={city} cityPins={cityPins} />
      <FlyTo focus={focusPin} pinIndex={pinIndex} />
      <ResizeWatcher />

      <Pane name="demand" style={{ zIndex: 350 }}>
        {layers.demand && (
          <DemandLayer shapes={shapes} city={city} pinStats={pinStats} activePin={activePin} onHoverPin={props.onHoverPin} onSelectPin={props.onSelectPin} />
        )}
      </Pane>

      <Pane name="radius" style={{ zIndex: 420, pointerEvents: 'none' }}>
        {layers.stores &&
          stores.map((s) => (
            <Circle
              key={`r-${s.id}`}
              center={[s.lat, s.lng]}
              radius={OVERLAP_RADIUS_KM[s.tier] * 1000}
              pathOptions={{ color: '#0f172a', weight: 1.5, fillColor: '#0f172a', fillOpacity: 0.07, interactive: false }}
            />
          ))}
        {layers.stores &&
          approved.map(({ r }) => {
            const p = pinIndex[r.pin as string];
            return (
              <Circle
                key={`ar-${r.uid}`}
                center={[p.lat, p.lng]}
                radius={OVERLAP_RADIUS_KM[p.tier] * 1000}
                pathOptions={{ color: DECISION_STYLE[r.decision].hex, weight: 1.2, dashArray: '2 4', fillOpacity: 0.04, fillColor: DECISION_STYLE[r.decision].hex, interactive: false }}
              />
            );
          })}
        {layers.catchments &&
          stores
            .filter((s) => s.catchment)
            .map((s) => (
              <Circle
                key={`c-${s.id}`}
                center={[s.lat, s.lng]}
                radius={(s.catchment as StoreCatchment).p80_customer_km * 1000}
                pathOptions={{ color: '#c2410c', weight: 1.6, dashArray: '6 6', fill: false, interactive: false }}
              />
            ))}
      </Pane>

      <Pane name="redirects" style={{ zIndex: 440 }}>
        {layers.redirects &&
          redirects.map((r) => {
            const from = pinIndex[r.pin as string];
            const to = pinIndex[r.redirect!.pin];
            const start = jitter(from.lat, from.lng, r.uid);
            return (
              <Polyline key={`l-${r.uid}`} positions={[start, [to.lat, to.lng]]} pathOptions={{ color: DECISION_STYLE.Redirect.hex, weight: 2, dashArray: '5 5', opacity: 0.85 }}>
                <Tooltip sticky>
                  <span className="text-xs">
                    <b>{r.appId}</b> {r.pin} → {r.redirect!.pin} {r.redirect!.pinName} · {fmtKm(r.redirect!.km)} · demand {Math.round(r.redirect!.demandIndex)}
                  </span>
                </Tooltip>
              </Polyline>
            );
          })}
        {layers.redirects &&
          redirects.map((r) => {
            const to = pinIndex[r.redirect!.pin];
            return (
              <CircleMarker
                key={`t-${r.uid}`}
                center={[to.lat, to.lng]}
                radius={7}
                pathOptions={{ color: DECISION_STYLE.Redirect.hex, weight: 2, fillColor: '#fff', fillOpacity: 0.9 }}
              >
                <Tooltip>
                  <span className="text-xs">
                    Suggested pin {r.redirect!.pin} {r.redirect!.pinName} for {r.appId}
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })}
      </Pane>

      <Pane name="applicants" style={{ zIndex: 460 }}>
        {layers.applicants &&
          placed.map(({ r, pos }) => {
            const st = DECISION_STYLE[r.decision];
            const big = r.decision === 'Approve' || r.decision === 'Approve with conditions';
            return (
              <CircleMarker
                key={r.uid}
                center={pos}
                radius={big ? 7 : 5.5}
                pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: st.hex, fillOpacity: 0.95 }}
                eventHandlers={{ click: () => props.onOpenApplicant(r.uid) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div className="text-xs">
                    <p className="font-semibold">
                      {r.appId} · {r.name}
                    </p>
                    <p style={{ color: st.hex }}>{r.decision}</p>
                    <p className="text-muted">
                      Pin {r.pin} · partner {Math.round(r.partnerScore)} · place {Math.round(r.place.placeScore)}
                    </p>
                    <p className="text-muted">Click for full reasons</p>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
      </Pane>

      {layers.stores &&
        stores.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={storeIcons[s.id]} zIndexOffset={1000}>
            <Popup>
              <StorePopup s={s} />
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
