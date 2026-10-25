// Side panels for the store network map: one per mode / selection. Every number says its unit and source.
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Result } from '../../types';
import { Button, DecisionBadge, cx, fmtInt, fmtKm } from '../components/ui';
import { BEST_PLACES, FLOW_COLOR, HEAVY_LIFTER_PCT, POTENTIAL, POTENTIAL_BY_PIN, storeArea, type FlowData, type PotentialPin } from './mapData';

/* ---------------- small building blocks ---------------- */

export function PanelSection({ title, note, children, action }: { title: string; note?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cx('tabular text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>{value}</span>
    </div>
  );
}

const lakh = (v: number) => `₹${v.toFixed(2)}L`;
const pct = (v: number) => `${Math.round(v)}%`;

/** Load vs capacity bar; with `after` it shows before (light) and after (solid). */
export function LoadBar({ load, capacity, after }: { load: number; capacity: number; after?: number }) {
  const p = (v: number) => Math.min(100, (v / capacity) * 100);
  const colour = (v: number) => (p(v) >= HEAVY_LIFTER_PCT ? 'bg-red-600' : 'bg-brand-600');
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
      {after === undefined ? (
        <div className={cx('h-full rounded-full', colour(load))} style={{ width: `${p(load)}%` }} />
      ) : (
        <>
          <div className="absolute inset-y-0 left-0 rounded-full bg-gray-300" style={{ width: `${p(load)}%` }} />
          <div className={cx('absolute inset-y-0 left-0 rounded-full', colour(after))} style={{ width: `${p(after)}%` }} />
        </>
      )}
      <div className="absolute inset-y-0 w-px bg-gray-500" style={{ left: `${HEAVY_LIFTER_PCT}%` }} title="75% of capacity" />
    </div>
  );
}

function Source({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-muted">{children}</p>;
}

function ApplicantList({ results, onOpen, empty }: { results: Result[]; onOpen: (uid: string) => void; empty: string }) {
  if (!results.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {results.map((r) => (
        <li key={r.uid}>
          <button className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-gray-50" onClick={() => onOpen(r.uid)}>
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink">
                {r.appId} · {r.name}
              </span>
              <span className="block text-xs text-muted">
                Pin {r.pin ?? '—'} · {r.territoryId ?? 'no territory'}
              </span>
            </span>
            <DecisionBadge decision={r.decision} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Today's traffic ---------------- */

export function NetworkPanel({ flows, selectStore }: { flows: FlowData; selectStore: (id: string) => void }) {
  const stores = [...flows.stores].sort((a, b) => b.utilisation_pct - a.utilisation_pct);
  const storeOrders = stores.reduce((s, x) => s + x.load_per_month, 0);
  const online = Object.values(flows.pins).reduce((s, x) => s + x.online, 0);
  const heavy = stores.filter((s) => s.utilisation_pct >= HEAVY_LIFTER_PCT);
  return (
    <>
      <PanelSection title="Store load today" note="Orders per month vs capacity of 600 a month (about 20 a day). Click a store to isolate it.">
        <ul className="space-y-3">
          {stores.map((s) => (
            <li key={s.id}>
              <button className="w-full text-left" onClick={() => selectStore(s.id)}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink">
                    {s.id} {storeArea(s.id, s.area)}
                    {s.utilisation_pct >= HEAVY_LIFTER_PCT && <span className="ml-2 text-xs font-medium text-decline">Heavy lifter</span>}
                  </span>
                  <span className="tabular text-muted">
                    {fmtInt(s.load_per_month)}/mo · <span className="text-ink">{pct(s.utilisation_pct)}</span>
                  </span>
                </div>
                <LoadBar load={s.load_per_month} capacity={s.capacity_per_month} />
              </button>
            </li>
          ))}
        </ul>
        <Source>Simulated store orders, {flows.meta.window}. Grey tick = 75% of capacity.</Source>
      </PanelSection>
      <PanelSection title="What this means">
        <Row label="Store orders per month (5 stores)" value={fmtInt(storeOrders)} />
        <Row label="Online orders per month (Bengaluru)" value={fmtInt(online)} />
        <Row label="Stores at 75% of capacity or more" value={heavy.length ? heavy.map((h) => h.id).join(', ') : 'None'} strong />
        <p className="mt-2 text-sm text-ink">
          {heavy.length
            ? `${heavy.map((h) => `${h.id} ${storeArea(h.id, h.area)}`).join(' and ')} ${heavy.length > 1 ? 'are' : 'is'} close to full. A new store nearby would take load off ${heavy.length > 1 ? 'them' : 'it'}: use "Plan a new store".`
            : 'No store is close to full today.'}
        </p>
      </PanelSection>
    </>
  );
}

export function StorePanel({
  flows,
  storeId,
  catchment,
  overlapKm,
  pinName,
  onBack,
  onPin,
}: {
  flows: FlowData;
  storeId: string;
  catchment: { avg_customer_km: number; p80_customer_km: number; pins_served: number } | null;
  overlapKm: number;
  pinName: (pin: string) => string;
  onBack: () => void;
  onPin: (pin: string) => void;
}) {
  const s = flows.stores.find((x) => x.id === storeId);
  if (!s) return <PanelSection title={storeId}>No order data for this store.</PanelSection>;
  const feeding = flows.baseline.filter((b) => b.store === storeId && b.perMonth > 0).sort((a, b) => b.perMonth - a.perMonth);
  const total = feeding.reduce((a, b) => a + b.perMonth, 0) || 1;
  return (
    <>
      <PanelSection
        title={`${s.id} ${storeArea(s.id, s.area)}`}
        note="Isolated: only the pins that buy at this store are shown."
        action={
          <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={onBack}>
            <ArrowLeft size={14} /> All stores
          </Button>
        }
      >
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-muted">Load vs capacity</span>
          <span className="tabular font-semibold text-ink">
            {fmtInt(s.load_per_month)} / {fmtInt(s.capacity_per_month)} orders/mo · {pct(s.utilisation_pct)}
          </span>
        </div>
        <LoadBar load={s.load_per_month} capacity={s.capacity_per_month} />
        {s.utilisation_pct >= HEAVY_LIFTER_PCT && (
          <p className="mt-2 text-sm text-decline">Heavy lifter: above 75% of capacity. Customers may wait for eye tests at peak hours.</p>
        )}
        <div className="mt-3">
          <Row label="Pins sending customers" value={fmtInt(feeding.length)} />
          {catchment && <Row label="Average customer travel" value={fmtKm(catchment.avg_customer_km)} />}
          {catchment && <Row label="80% of customers live within" value={fmtKm(catchment.p80_customer_km)} />}
          <Row label="Overlap radius (rulebook)" value={fmtKm(overlapKm)} />
        </div>
      </PanelSection>
      <PanelSection title="Where its customers come from" note="Top pins by store orders per month">
        <ul className="divide-y divide-line">
          {feeding.slice(0, 8).map((f) => (
            <li key={f.pin}>
              <button className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => onPin(f.pin)}>
                <span className="truncate text-ink">
                  {f.pin} {pinName(f.pin)}
                </span>
                <span className="tabular shrink-0 text-muted">
                  <span className="text-ink">{fmtInt(f.perMonth)}</span>/mo · {pct((f.perMonth / total) * 100)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Source>Simulated store orders, {flows.meta.window}, scaled to Tier 1 sales.</Source>
      </PanelSection>
    </>
  );
}

export function PinTrafficPanel({ flows, pin, pinName, onBack, onSimulate }: { flows: FlowData; pin: string; pinName: string; onBack: () => void; onSimulate: () => void }) {
  const p = flows.pins[pin];
  const pot = POTENTIAL_BY_PIN[pin];
  const routes = flows.baseline.filter((b) => b.pin === pin && b.perMonth > 0).sort((a, b) => b.perMonth - a.perMonth);
  return (
    <PanelSection
      title={`${pin} ${pinName}`}
      action={
        <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </Button>
      }
    >
      {p ? (
        <>
          <Row label="Store orders per month" value={fmtInt(p.store)} />
          <Row label="Online orders per month" value={fmtInt(p.online)} />
          <Row label="Missed orders per month" value={fmtInt(p.missed)} />
          {pot && <Row label="Nearest store" value={`${pot.nearest_store_id} · ${fmtKm(pot.nearest_store_km)}`} />}
          <p className="mb-1 mt-3 text-xs font-medium text-muted">Which stores its customers visit</p>
          {routes.length ? (
            routes.map((r) => <Row key={r.store} label={r.store} value={`${fmtInt(r.perMonth)} orders/mo`} />)
          ) : (
            <p className="text-sm text-muted">No store orders from this pin.</p>
          )}
          <Button variant="primary" className="mt-4 w-full" onClick={onSimulate}>
            Simulate a new store here <ArrowRight size={14} />
          </Button>
          <Source>Simulated orders, {flows.meta.window}.</Source>
        </>
      ) : (
        <p className="text-sm text-muted">No order data for this pin.</p>
      )}
    </PanelSection>
  );
}

/* ---------------- Leaks ---------------- */

export function LeaksPanel({ flows, selectedPin, onPin, onSimulate }: { flows: FlowData; selectedPin: string | null; onPin: (pin: string | null) => void; onSimulate: (pin: string) => void }) {
  const totalMissed = POTENTIAL.reduce((a, p) => a + p.missed_orders_month, 0);
  const totalLakh = POTENTIAL.reduce((a, p) => a + p.missed_sales_lakh_month, 0);
  const totalFar = POTENTIAL.reduce((a, p) => a + p.redirected_orders_month, 0);
  const top = [...POTENTIAL].sort((a, b) => b.missed_sales_lakh_month - a.missed_sales_lakh_month || a.pin.localeCompare(b.pin)).slice(0, 10);
  const sel = selectedPin ? POTENTIAL_BY_PIN[selectedPin] : null;
  const storeName = (id: string) => storeArea(id, flows.stores.find((s) => s.id === id)?.area ?? id);
  return (
    <>
      {sel && (
        <PanelSection
          title={`${sel.pin} ${sel.name}`}
          action={
            <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => onPin(null)}>
              <ArrowLeft size={14} /> All pins
            </Button>
          }
        >
          <Row label="Missed orders per month" value={fmtInt(sel.missed_orders_month)} strong />
          <Row label="Missed sales per month" value={lakh(sel.missed_sales_lakh_month)} strong />
          <Row label="Orders travelling more than 4 km" value={`${fmtInt(sel.redirected_orders_month)}/mo`} />
          <Row label="Nearest store" value={`${sel.nearest_store_id} · ${fmtKm(sel.nearest_store_km)}`} />
          {sel.redirected_to.filter((r) => r.ordersPerMonth > 0).length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs font-medium text-muted">Far stores these customers travel to</p>
              {sel.redirected_to
                .filter((r) => r.ordersPerMonth > 0)
                .map((r) => (
                  <Row key={r.store} label={`${r.store} ${storeName(r.store)}`} value={`${fmtInt(r.ordersPerMonth)} orders/mo`} />
                ))}
            </>
          )}
          {sel.verdict !== 'Existing store here' && (
            <Button variant="primary" className="mt-4 w-full" onClick={() => onSimulate(sel.pin)}>
              Simulate a new store here <ArrowRight size={14} />
            </Button>
          )}
        </PanelSection>
      )}
      <PanelSection title="Total leak in Bengaluru" note="Customers who would buy in a store if one were in their pin, but don't today.">
        <Row label="Missed orders per month" value={fmtInt(totalMissed)} strong />
        <Row label="Missed sales per month" value={lakh(totalLakh)} strong />
        <Row label="Orders travelling more than 4 km (at risk)" value={`${fmtInt(totalFar)}/mo`} />
      </PanelSection>
      <PanelSection title="Top 10 leaking pins" note="Missed sales per month. Click a pin to see where its customers go.">
        <ul className="divide-y divide-line">
          {top.map((p) => (
            <li key={p.pin}>
              <button
                className={cx('flex w-full items-baseline justify-between gap-2 py-1.5 text-left text-sm hover:bg-gray-50', p.pin === selectedPin && 'bg-brand-50')}
                onClick={() => onPin(p.pin)}
              >
                <span className="truncate text-ink">
                  {p.pin} {p.name}
                </span>
                <span className="tabular shrink-0 text-muted">
                  {fmtInt(p.missed_orders_month)} orders · <span className="text-ink">{lakh(p.missed_sales_lakh_month)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Source>
          Simulated orders, {flows.meta.window}. Missed = store purchases a pin's customers would make with a store in their own pin, minus what they make today.
        </Source>
      </PanelSection>
    </>
  );
}

/* ---------------- Plan a new store ---------------- */

export function BestPlaces({ selectedPin, onPick }: { selectedPin: string | null; onPick: (pin: string) => void }) {
  return (
    <PanelSection title="Best places for a new store" note="Ranked by new orders won per month (not taken from our own stores)">
      <ul className="divide-y divide-line">
        {BEST_PLACES.map((p, i) => (
          <li key={p.pin}>
            <button
              className={cx('flex w-full items-baseline justify-between gap-2 py-1.5 text-left text-sm hover:bg-gray-50', p.pin === selectedPin && 'bg-brand-50')}
              onClick={() => onPick(p.pin)}
            >
              <span className="truncate text-ink">
                <span className="tabular mr-2 text-muted">{i + 1}.</span>
                {p.pin} {p.name}
              </span>
              <span className="tabular shrink-0 text-muted">
                +<span className="text-ink">{fmtInt(p.incremental_orders_month)}</span>/mo · {p.payback_months === null ? '—' : `${p.payback_months.toFixed(0)} mo payback`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Source>Simulated orders × rulebook economics. Existing-store pins excluded.</Source>
    </PanelSection>
  );
}

export interface StoreShift {
  id: string;
  area: string;
  before: number;
  after: number;
  capacity: number;
}

export function ImpactPanel({
  pot,
  radiusKm,
  shifts,
  applicants,
  territoryLabel,
  heldBy,
  meta,
  onOpenApplicant,
  onClear,
}: {
  pot: PotentialPin;
  radiusKm: number | null;
  shifts: StoreShift[];
  applicants: Result[];
  territoryLabel: string | null;
  heldBy: string | null;
  meta: FlowData['meta'];
  onOpenApplicant: (uid: string) => void;
  onClear: () => void;
}) {
  const existing = pot.verdict === 'Existing store here';
  const moved = shifts.filter((s) => s.before - s.after > 0).sort((a, b) => b.before - b.after - (a.before - a.after));
  const relief = moved.filter((s) => (s.before / s.capacity) * 100 >= HEAVY_LIFTER_PCT);
  const risk = moved.filter((s) => (s.after / s.capacity) * 100 < 35);
  const u = (v: number, cap: number) => Math.round((v / cap) * 100);
  const good = pot.verdict === 'Viable';
  return (
    <>
      <PanelSection
        title={`Impact of a store at ${pot.pin} ${pot.name}`}
        note="What changes in the first full year if a franchise opens here"
        action={
          <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={onClear}>
            Clear
          </Button>
        }
      >
        {existing ? (
          <p className="text-sm text-ink">A store already operates in this pin. The brand never opens two stores in one pin, so this pin cannot take a franchise.</p>
        ) : (
          <>
            <p className={cx('mb-3 text-sm font-medium', good ? 'text-approve' : 'text-waitlist')}>
              {good ? 'Viable: pays back within the 30-month target.' : `${pot.verdict}: payback is longer than the 30-month target.`}
            </p>
            {heldBy && <p className="mb-3 text-sm text-ink">This pin is already allocated to {heldBy} in the current decisions.</p>}
            <Row label="Orders per month the store would serve" value={fmtInt(pot.potential_orders_month)} strong />
            <div className="ml-3 border-l border-line pl-3">
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3" style={{ background: FLOW_COLOR.won }} /> New orders won back
                  </span>
                }
                value={fmtInt(pot.incremental_orders_month)}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3" style={{ background: FLOW_COLOR.taken }} /> Taken from our stores
                  </span>
                }
                value={fmtInt(pot.cannibalised_orders_month)}
              />
              {pot.cannibalised_from
                .filter((c) => c.ordersPerMonth > 0)
                .map((c) => (
                  <Row key={c.store} label={<span className="pl-4">from {c.store} {storeArea(c.store, c.area)}</span>} value={fmtInt(c.ordersPerMonth)} />
                ))}
            </div>
            <Row label="Capacity use (of 600/mo)" value={pct(pot.capacity_use_pct)} />
            <Row label="Est. sales per month" value={lakh(pot.est_sales_lakh_month)} />
            <Row label="Est. profit per month" value={lakh(pot.est_profit_lakh_month)} />
            <Row label="Payback" value={pot.payback_months === null ? 'Never at this volume' : `${pot.payback_months.toFixed(1)} months`} strong />
            <Row label="Annual return on investment" value={pct(pot.annual_roi_pct)} />
            {radiusKm !== null && <Row label="Catchment radius" value={fmtKm(radiusKm)} />}
            <Source>
              Simulated orders, {meta.window}. Economics: ₹{meta.investment_lakh}L investment, ₹{meta.fixed_cost_lakh_month}L fixed cost a month,{' '}
              {Math.round(meta.contribution_margin * 100)}% margin (rulebook assumptions).
            </Source>
          </>
        )}
      </PanelSection>

      {!existing && shifts.length > 0 && (
        <PanelSection title="Load on existing stores: before → after" note="Grey = today, colour = after the new store opens">
          <ul className="space-y-3">
            {shifts.map((s) => (
              <li key={s.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink">
                    {s.id} {s.area}
                  </span>
                  <span className="tabular text-muted">
                    {pct(u(s.before, s.capacity))} → <span className="font-semibold text-ink">{pct(u(s.after, s.capacity))}</span>
                  </span>
                </div>
                <LoadBar load={s.before} capacity={s.capacity} after={s.after} />
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 text-sm text-ink">
            {relief.map((s) => (
              <p key={s.id}>
                Relieves heavy lifter {s.id}: {pct(u(s.before, s.capacity))} → {pct(u(s.after, s.capacity))} of capacity ({fmtInt(s.before - s.after)} orders/mo move).
              </p>
            ))}
            {risk.map((s) => (
              <p key={`r-${s.id}`} className="text-waitlist">
                Watch {s.id}: falls to {pct(u(s.after, s.capacity))} of capacity.
              </p>
            ))}
            {!moved.length && <p>No existing store loses orders: every order here is new.</p>}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Applicants for this pin and territory" note={territoryLabel ?? 'This pin is not in any uploaded territory'}>
        <ApplicantList results={applicants} onOpen={onOpenApplicant} empty="No applicant has asked for this pin or its territory yet. It is an open gap." />
      </PanelSection>
    </>
  );
}

/* ---------------- Other cities ---------------- */

export function OtherCityPanel({
  city,
  stores,
  topPins,
  selectedPin,
  pinDetail,
  approved,
  onPin,
  onOpenApplicant,
}: {
  city: string;
  stores: { id: string; pin: string; opened: number; overlapKm: number }[];
  topPins: { pin: string; name: string; index: number; nearestKm: number | null }[];
  selectedPin: string | null;
  pinDetail: { pin: string; name: string; index: number; nearestStore: string | null; nearestKm: number | null; applicants: Result[] } | null;
  approved: Result[];
  onPin: (pin: string | null) => void;
  onOpenApplicant: (uid: string) => void;
}) {
  return (
    <>
      {pinDetail && (
        <PanelSection
          title={`${pinDetail.pin} ${pinDetail.name}`}
          action={
            <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => onPin(null)}>
              <ArrowLeft size={14} /> Back
            </Button>
          }
        >
          <Row label="Demand proxy (0-100)" value={pinDetail.index} strong />
          <Row label="Nearest store" value={pinDetail.nearestStore ? `${pinDetail.nearestStore} · ${fmtKm(pinDetail.nearestKm)}` : 'None in this city'} />
          <p className="mb-1 mt-3 text-xs font-medium text-muted">Applicants for this pin</p>
          <ApplicantList results={pinDetail.applicants} onOpen={onOpenApplicant} empty="No applicant for this pin." />
          <Source>Proxy = rulebook tier base + bonus within 3 km of the city centre. Not order data.</Source>
        </PanelSection>
      )}
      <PanelSection title={`Stores in ${city}`}>
        {stores.length ? (
          stores.map((s) => <Row key={s.id} label={`${s.id} · pin ${s.pin}`} value={`opened ${s.opened} · ${fmtKm(s.overlapKm)} radius`} />)
        ) : (
          <p className="text-sm text-ink">No stores yet: open market. Any viable pin can take the first franchise.</p>
        )}
      </PanelSection>
      <PanelSection title="Highest-demand pins" note="Demand proxy, not order data">
        <ul className="divide-y divide-line">
          {topPins.map((p) => (
            <li key={p.pin}>
              <button
                className={cx('flex w-full items-baseline justify-between gap-2 py-1.5 text-left text-sm hover:bg-gray-50', p.pin === selectedPin && 'bg-brand-50')}
                onClick={() => onPin(p.pin)}
              >
                <span className="truncate text-ink">
                  {p.pin} {p.name}
                </span>
                <span className="tabular shrink-0 text-muted">
                  {p.index} · {p.nearestKm === null ? 'no store' : `${fmtKm(p.nearestKm)} to store`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>
      <PanelSection title="Approved franchises here">
        <ApplicantList results={approved} onOpen={onOpenApplicant} empty="None approved in this city in the current decisions." />
      </PanelSection>
    </>
  );
}
