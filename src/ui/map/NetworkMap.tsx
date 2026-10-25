// Generic Leaflet renderer for the store network map. All geometry is computed (and memoised) by the page;
// this component only draws: pin shading, circles, flow lines, store markers, a planned store and approved franchises.
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Feature, Geometry } from 'geojson';
import type { PinInfo } from '../../types';
import { CITY_CENTRE } from '../../config/rules';
import type { PinShapeProps, PinShapes } from './mapData';

export interface PinPaint {
  fill: string;
  opacity: number; // fill opacity
  emphasis?: boolean; // dark outline (selected)
  label: string; // tooltip
}

export interface MapLine {
  key: string;
  positions: [number, number][];
  color: string;
  weight: number;
  opacity?: number;
  dash?: string;
  tooltip?: string;
}

export interface MapCircle {
  key: string;
  center: [number, number];
  radiusM: number;
  color: string;
  dash?: string;
  fillOpacity?: number;
  tooltip?: string;
}

export interface StoreMarker {
  id: string;
  lat: number;
  lng: number;
  /** Ring fill 0-100 (utilisation); null when there is no load data. */
  pct: number | null;
  heavy: boolean;
  dimmed: boolean;
  selected: boolean;
  caption: string; // short text under the marker, e.g. "ST-01 · 86%"
  tooltip: string;
  size: number; // px diameter
}

export interface PointMarker {
  key: string;
  pos: [number, number];
  color: string;
  radius: number;
  tooltip: string;
  onClick?: () => void;
}

interface Props {
  city: string;
  cityPins: PinInfo[];
  shapes: PinShapes | null;
  paint: Record<string, PinPaint>;
  lines: MapLine[];
  circles: MapCircle[];
  stores: StoreMarker[];
  points: PointMarker[];
  newStore: { lat: number; lng: number; label: string } | null;
  focus: { lat: number; lng: number; zoom: number; nonce: string } | null;
  /** Initial view: fit these points (e.g. the city's stores) instead of every pin. */
  fitTo: [number, number][] | null;
  onPinClick: (pin: string) => void;
  onStoreClick: (id: string) => void;
}

function storeIcon(s: StoreMarker): L.DivIcon {
  const ring = s.heavy ? '#b91c1c' : '#1d4ed8';
  const pct = s.pct ?? 0;
  const bg = s.pct === null ? '#111827' : `conic-gradient(${ring} ${pct}%, #e5e7eb 0)`;
  const inner = s.size - 8;
  const outline = s.selected ? 'box-shadow:0 0 0 3px #111827;' : 'box-shadow:0 1px 4px rgba(17,24,39,.35);';
  return L.divIcon({
    className: '',
    iconSize: [s.size, s.size],
    iconAnchor: [s.size / 2, s.size / 2],
    html: `<div style="opacity:${s.dimmed ? 0.35 : 1};position:relative;width:${s.size}px;height:${s.size}px">
      <div style="width:${s.size}px;height:${s.size}px;border-radius:9999px;background:${bg};${outline}display:flex;align-items:center;justify-content:center">
        <div style="width:${inner}px;height:${inner}px;border-radius:9999px;background:#111827;border:2px solid #fff"></div>
      </div>
      <div style="position:absolute;top:${s.size + 2}px;left:50%;transform:translateX(-50%);white-space:nowrap;font:600 11px Inter,system-ui,sans-serif;color:${s.heavy ? '#991b1b' : '#111827'};background:rgba(255,255,255,.92);padding:1px 5px;border-radius:4px;border:1px solid #e5e7eb">${s.caption}</div>
    </div>`,
  });
}

const NEW_STORE_ICON = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: `<div style="width:30px;height:30px;border-radius:8px;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 0 2px #1d4ed8,0 2px 6px rgba(17,24,39,.4);display:flex;align-items:center;justify-content:center;color:#fff;font:700 10px Inter,system-ui,sans-serif">NEW</div>`,
});

function FitCity({ city, cityPins, fitTo }: { city: string; cityPins: PinInfo[]; fitTo: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (fitTo && fitTo.length > 1) {
      map.fitBounds(L.latLngBounds(fitTo).pad(0.55), { animate: false, maxZoom: 13 });
    } else if (cityPins.length) {
      map.fitBounds(L.latLngBounds(cityPins.map((p) => [p.lat, p.lng] as [number, number])).pad(0.04), { animate: false, maxZoom: 13 });
    } else {
      const c = CITY_CENTRE[city as keyof typeof CITY_CENTRE];
      if (c) map.setView([c.lat, c.lng], 12);
    }
  // fitTo is derived from the city; refit only when the city changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, cityPins, map]);
  return null;
}

function FlyTo({ focus }: { focus: Props['focus'] }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 0.6 });
    // nonce drives re-focus; coordinates alone may repeat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, map]);
  return null;
}

/** Leaflet measures its container once; re-measure when the layout settles (mobile stack / sidebar). */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function PinLayer({ shapes, city, cityPins, paint, onPinClick }: Pick<Props, 'shapes' | 'city' | 'cityPins' | 'paint' | 'onPinClick'>) {
  const ref = useRef<L.GeoJSON | null>(null);
  const click = useRef(onPinClick);
  click.current = onPinClick;
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const data = useMemo(() => (shapes ? { ...shapes, features: shapes.features.filter((f) => f.properties.city === city) } : null), [shapes, city]);

  const styleFor = (pin: string): L.PathOptions => {
    const p = paintRef.current[pin];
    return {
      fillColor: p?.fill ?? '#f3f4f6',
      fillOpacity: p?.opacity ?? 0.25,
      color: p?.emphasis ? '#111827' : '#ffffff',
      weight: p?.emphasis ? 2.5 : 0.8,
    };
  };

  // Restyle in place when the paint changes (no layer rebuild).
  useEffect(() => {
    ref.current?.eachLayer((l) => {
      const f = (l as L.Path & { feature?: Feature<Geometry, PinShapeProps> }).feature;
      if (!f) return;
      (l as L.Path).setStyle(styleFor(f.properties.pin));
      const label = paint[f.properties.pin]?.label;
      if (label) (l as L.Path).setTooltipContent(label);
    });
  });

  if (!data) {
    // Fallback while boundaries load (or if they fail): one dot per pin centroid.
    return (
      <>
        {cityPins.map((p) => {
          const s = paint[p.pin];
          return (
            <CircleMarker
              key={p.pin}
              center={[p.lat, p.lng]}
              radius={6}
              pathOptions={{ color: '#fff', weight: 1, fillColor: s?.fill ?? '#e5e7eb', fillOpacity: Math.max(0.4, s?.opacity ?? 0.4) }}
              eventHandlers={{ click: () => click.current(p.pin) }}
            >
              {s?.label && <Tooltip>{s.label}</Tooltip>}
            </CircleMarker>
          );
        })}
      </>
    );
  }
  return (
    <GeoJSON
      key={city}
      ref={ref}
      data={data}
      style={(f) => styleFor((f?.properties as PinShapeProps).pin)}
      onEachFeature={(f, layer) => {
        const pin = (f.properties as PinShapeProps).pin;
        layer.bindTooltip(paintRef.current[pin]?.label ?? pin, { sticky: true, className: 'text-xs' });
        layer.on({ click: () => click.current(pin) });
      }}
    />
  );
}

export function NetworkMap(props: Props) {
  const { city, cityPins, shapes, paint, lines, circles, stores, points, newStore, focus } = props;
  const centre = CITY_CENTRE[city as keyof typeof CITY_CENTRE] ?? CITY_CENTRE.Bengaluru;
  const storeClick = useRef(props.onStoreClick);
  storeClick.current = props.onStoreClick;

  const icons = useMemo(() => stores.map((s) => ({ s, icon: storeIcon(s) })), [stores]);

  return (
    <MapContainer center={[centre.lat, centre.lng]} zoom={11} minZoom={7} maxZoom={17} scrollWheelZoom className="h-full w-full" zoomControl>
      <TileLayer
        attribution="Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
      />
      <FitCity city={city} cityPins={cityPins} fitTo={props.fitTo} />
      <FlyTo focus={focus} />
      <ResizeWatcher />

      <Pane name="pins" style={{ zIndex: 350 }}>
        <PinLayer shapes={shapes} city={city} cityPins={cityPins} paint={paint} onPinClick={props.onPinClick} />
      </Pane>

      <Pane name="circles" style={{ zIndex: 410, pointerEvents: 'none' }}>
        {circles.map((c) => (
          <Circle
            key={c.key}
            center={c.center}
            radius={c.radiusM}
            pathOptions={{ color: c.color, weight: 1.6, dashArray: c.dash, fillColor: c.color, fillOpacity: c.fillOpacity ?? 0, interactive: false }}
          />
        ))}
      </Pane>

      <Pane name="lines" style={{ zIndex: 430 }}>
        {lines.map((l) => (
          <Polyline key={l.key} positions={l.positions} pathOptions={{ color: l.color, weight: l.weight, opacity: l.opacity ?? 0.85, dashArray: l.dash, lineCap: 'round' }}>
            {l.tooltip && <Tooltip sticky>{l.tooltip}</Tooltip>}
          </Polyline>
        ))}
      </Pane>

      <Pane name="points" style={{ zIndex: 460 }}>
        {points.map((p) => (
          <CircleMarker
            key={p.key}
            center={p.pos}
            radius={p.radius}
            pathOptions={{ color: '#111827', weight: 1.5, fillColor: p.color, fillOpacity: 1 }}
            eventHandlers={p.onClick ? { click: p.onClick } : undefined}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {p.tooltip}
            </Tooltip>
          </CircleMarker>
        ))}
      </Pane>

      {icons.map(({ s, icon }) => (
        <Marker key={s.id} position={[s.lat, s.lng]} icon={icon} zIndexOffset={s.selected ? 2000 : 1000} eventHandlers={{ click: () => storeClick.current(s.id) }}>
          <Tooltip direction="top" offset={[0, -s.size / 2]}>
            {s.tooltip}
          </Tooltip>
        </Marker>
      ))}

      {newStore && (
        <Marker position={[newStore.lat, newStore.lng]} icon={NEW_STORE_ICON} zIndexOffset={3000}>
          <Tooltip direction="top" offset={[0, -16]} permanent>
            {newStore.label}
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
