// Overview charts (recharts). Decision colours come from DECISION_STYLE so every chart matches the badges.
// Each chart: legend above the plot, hover tooltip per mark, and a table view for exact numbers.
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { DECISIONS, type Decision, type Result, type TerritoryStatus } from '../../types';
import { DECISION_STYLE, cx } from '../components/ui';
import { PAYBACK_TARGET_MONTHS, PARTNER_BAR } from '../../config/rules';

const AXIS = { stroke: '#cbd5e1', tick: { fill: '#64748b', fontSize: 11 }, tickLine: false } as const;
const GRID = '#eef2f6';

/* ---------- shared bits ---------- */

export function ViewToggle({ value, onChange }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-slate-50 p-0.5 text-[11px] font-medium">
      {(['chart', 'table'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cx('rounded-md px-2 py-1 capitalize', value === v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function TipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-[260px] rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {children}
    </div>
  );
}

function TipRow({ color, label, value }: { color?: string; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {color && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />}
      <span className="flex-1 text-muted">{label}</span>
      <span className="tabular font-medium text-ink">{value}</span>
    </div>
  );
}

export function DecisionLegend({ decisions = DECISIONS, active, onToggle }: { decisions?: Decision[]; active?: Decision | null; onToggle?: (d: Decision) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {decisions.map((d) => {
        const dim = active && active !== d;
        const Tag = onToggle ? 'button' : 'span';
        return (
          <Tag
            key={d}
            onClick={onToggle ? () => onToggle(d) : undefined}
            className={cx('inline-flex items-center gap-1.5 text-[11px] text-slate-600', onToggle && 'rounded hover:text-ink', dim && 'opacity-40')}
          >
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DECISION_STYLE[d].hex }} />
            {DECISION_STYLE[d].short}
          </Tag>
        );
      })}
    </div>
  );
}

/* ---------- 1. Decisions by city (horizontal stacked bar) ---------- */

type CityRow = { city: string; total: number } & Record<Decision, number>;

export function cityRows(results: Result[]): CityRow[] {
  const map = new Map<string, CityRow>();
  for (const r of results) {
    const city = r.city || 'Unknown';
    const row = map.get(city) ?? ({ city, total: 0, Approve: 0, 'Approve with conditions': 0, Redirect: 0, Waitlist: 0, Hold: 0, Decline: 0 } as CityRow);
    row[r.decision] += 1;
    row.total += 1;
    map.set(city, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.city.localeCompare(b.city));
}

export function DecisionsByCityChart({ results }: { results: Result[] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = useMemo(() => cityRows(results), [results]);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <DecisionLegend />
        <ViewToggle value={view} onChange={setView} />
      </div>
      {view === 'chart' ? (
        <div style={{ height: Math.max(180, rows.length * 34 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barCategoryGap={7}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} {...AXIS} />
              <YAxis type="category" dataKey="city" width={104} {...AXIS} axisLine={false} interval={0} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as CityRow;
                  return (
                    <TipBox title={`${row.city} · ${row.total} applications`}>
                      {DECISIONS.filter((d) => row[d] > 0).map((d) => (
                        <TipRow key={d} color={DECISION_STYLE[d].hex} label={d} value={row[d]} />
                      ))}
                    </TipBox>
                  );
                }}
              />
              {DECISIONS.map((d, i) => (
                <Bar
                  key={d}
                  dataKey={d}
                  stackId="c"
                  fill={DECISION_STYLE[d].hex}
                  stroke="#fff"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  radius={i === DECISIONS.length - 1 ? [0, 4, 4, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1.5 pr-2 font-medium">City</th>
                {DECISIONS.map((d) => (
                  <th key={d} className="px-1 py-1.5 text-right font-medium">{DECISION_STYLE[d].short}</th>
                ))}
                <th className="py-1.5 pl-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={r.city} className="border-t border-line">
                  <td className="py-1.5 pr-2 font-medium text-ink">{r.city}</td>
                  {DECISIONS.map((d) => (
                    <td key={d} className={cx('px-1 py-1.5 text-right', r[d] ? 'text-ink' : 'text-slate-300')}>{r[d]}</td>
                  ))}
                  <td className="py-1.5 pl-2 text-right font-semibold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- 2. Partner score vs payback (scatter) ---------- */

type Pt = { x: number; y: number; uid: string; appId: string; name: string; decision: Decision; capped: boolean };
const Y_CAP = 60;

export function ScorePaybackScatter({ results, onPick }: { results: Result[]; onPick: (uid: string) => void }) {
  const [focus, setFocus] = useState<Decision | null>(null);
  const { pts, noPayback } = useMemo(() => {
    const pts: Pt[] = [];
    let noPayback = 0;
    for (const r of results) {
      const pb = r.economics?.paybackMonths;
      if (pb === null || pb === undefined || !Number.isFinite(pb)) {
        noPayback += 1;
        continue;
      }
      pts.push({ x: r.partnerScore, y: Math.min(pb, Y_CAP), uid: r.uid, appId: r.appId, name: r.name, decision: r.decision, capped: pb > Y_CAP });
    }
    return { pts, noPayback };
  }, [results]);
  const present = DECISIONS.filter((d) => pts.some((p) => p.decision === d));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DecisionLegend decisions={present} active={focus} onToggle={(d) => setFocus((f) => (f === d ? null : d))} />
        <span className="text-[11px] text-muted">{focus ? 'Click the legend again to show all' : 'Click a legend item to focus it'}</span>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: -8 }}>
            <CartesianGrid stroke={GRID} />
            <ReferenceArea x1={PARTNER_BAR.strong} x2={100} y1={0} y2={PAYBACK_TARGET_MONTHS} fill="#15803d" fillOpacity={0.05} />
            <XAxis
              type="number" dataKey="x" domain={[0, 100]} ticks={[0, 20, 40, PARTNER_BAR.conditional, PARTNER_BAR.strong, 85, 100]} {...AXIS}
              label={{ value: 'Partner score (0–100)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="y" domain={[0, Y_CAP]} ticks={[0, 10, 20, 30, 40, 50, 60]} {...AXIS}
              label={{ value: 'Payback (months)', angle: -90, position: 'insideLeft', offset: 18, fill: '#64748b', fontSize: 11 }}
            />
            <ZAxis range={[56, 56]} />
            <ReferenceLine y={PAYBACK_TARGET_MONTHS} stroke="#b91c1c" strokeDasharray="4 3" label={{ value: `${PAYBACK_TARGET_MONTHS}-month target`, position: 'insideTopRight', fill: '#b91c1c', fontSize: 10 }} />
            <ReferenceLine x={PARTNER_BAR.conditional} stroke="#94a3b8" strokeDasharray="3 3" />
            <ReferenceLine x={PARTNER_BAR.strong} stroke="#94a3b8" strokeDasharray="3 3" />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Pt;
                return (
                  <TipBox title={`${p.appId} · ${p.name}`}>
                    <TipRow color={DECISION_STYLE[p.decision].hex} label="Decision" value={p.decision} />
                    <TipRow label="Partner score" value={p.x.toFixed(0)} />
                    <TipRow label="Payback" value={p.capped ? `> ${Y_CAP} mo` : `${p.y.toFixed(1)} mo`} />
                    <p className="mt-1 text-[10px] text-muted">Click to open the applicant</p>
                  </TipBox>
                );
              }}
            />
            <Scatter data={pts} isAnimationActive={false} onClick={(d: { payload?: Pt }) => d?.payload && onPick(d.payload.uid)} cursor="pointer">
              {pts.map((p) => {
                const on = !focus || focus === p.decision;
                return <Cell key={p.uid} fill={on ? DECISION_STYLE[p.decision].hex : '#cbd5e1'} fillOpacity={on ? 0.85 : 0.35} stroke="#fff" strokeWidth={1.5} />;
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Shaded corner = strong partner ({PARTNER_BAR.strong}+) and payback inside {PAYBACK_TARGET_MONTHS} months. Dashed lines: partner bars at {PARTNER_BAR.conditional} and {PARTNER_BAR.strong}.
        {noPayback > 0 && ` ${noPayback} applicant${noPayback === 1 ? '' : 's'} not plotted (store would not make a profit, or payback could not be worked out).`}
        {pts.some((p) => p.capped) && ` Paybacks over ${Y_CAP} months are drawn at the top edge.`}
      </p>
    </div>
  );
}

/* ---------- 3. Territory fill (filled vs open slots) ---------- */

export function TerritoryFillChart({ territories, onOpen }: { territories: TerritoryStatus[]; onOpen?: () => void }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = useMemo(
    () =>
      territories
        .map((t) => {
          const filled = Math.min(t.filled.length, t.openSlots);
          return { id: t.id, label: `${t.id} · ${t.city}`, city: t.city, priority: t.priority, filled, open: Math.max(0, t.openSlots - filled), slots: t.openSlots, contenders: t.contenders.length };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    [territories],
  );
  type Row = (typeof rows)[number];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" />Slots filled</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />Still open</span>
        </div>
        <ViewToggle value={view} onChange={setView} />
      </div>
      {view === 'chart' ? (
        <div style={{ height: Math.max(160, rows.length * 26 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={5} onClick={onOpen ? () => onOpen() : undefined}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} {...AXIS} />
              <YAxis type="category" dataKey="id" width={54} {...AXIS} axisLine={false} interval={0} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0].payload as Row;
                  return (
                    <TipBox title={r.label}>
                      <TipRow label="Priority" value={r.priority} />
                      <TipRow color="#0d9488" label="Slots filled" value={`${r.filled} of ${r.slots}`} />
                      <TipRow color="#e2e8f0" label="Still open" value={r.open} />
                      <TipRow label="Other contenders" value={r.contenders} />
                    </TipBox>
                  );
                }}
              />
              <Bar dataKey="filled" stackId="s" fill="#0d9488" stroke="#fff" strokeWidth={1.5} isAnimationActive={false} />
              <Bar dataKey="open" stackId="s" fill="#e2e8f0" stroke="#fff" strokeWidth={1.5} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-muted">
                <th className="py-1.5 font-medium">Territory</th>
                <th className="py-1.5 font-medium">Priority</th>
                <th className="py-1.5 text-right font-medium">Filled</th>
                <th className="py-1.5 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1.5 font-medium text-ink">{r.label}</td>
                  <td className="py-1.5 text-muted">{r.priority}</td>
                  <td className="py-1.5 text-right">{r.filled} / {r.slots}</td>
                  <td className="py-1.5 text-right">{r.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
