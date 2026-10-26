// Shared UI primitives. Every page builds from these so the console looks like one system.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Decision } from '../../types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const DECISION_STYLE: Record<Decision, { text: string; bg: string; dot: string; hex: string; short: string }> = {
  Approve: { text: 'text-approve', bg: 'bg-green-50 ring-green-200', dot: 'bg-approve', hex: '#15803d', short: 'Approve' },
  'Approve with conditions': { text: 'text-conditional', bg: 'bg-sky-50 ring-sky-200', dot: 'bg-conditional', hex: '#0369a1', short: 'Conditional' },
  Redirect: { text: 'text-redirect', bg: 'bg-violet-50 ring-violet-200', dot: 'bg-redirect', hex: '#7c3aed', short: 'Redirect' },
  Waitlist: { text: 'text-waitlist', bg: 'bg-amber-50 ring-amber-200', dot: 'bg-waitlist', hex: '#b45309', short: 'Waitlist' },
  Hold: { text: 'text-hold', bg: 'bg-slate-100 ring-slate-300', dot: 'bg-hold', hex: '#475569', short: 'Hold' },
  Decline: { text: 'text-decline', bg: 'bg-red-50 ring-red-200', dot: 'bg-decline', hex: '#b91c1c', short: 'Decline' },
};

export function DecisionBadge({ decision, size = 'sm' }: { decision: Decision; size?: 'sm' | 'md' }) {
  const s = DECISION_STYLE[decision];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap', s.bg, s.text, size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {decision}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad'; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className={cx('tabular mt-2 text-2xl font-semibold', tone === 'good' && 'text-approve', tone === 'warn' && 'text-waitlist', tone === 'bad' && 'text-decline')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-900',
        variant === 'secondary' && 'border border-line bg-white text-ink hover:bg-slate-50',
        variant === 'ghost' && 'text-muted hover:bg-slate-100 hover:text-ink',
        className,
      )}
    />
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'good' | 'warn' | 'bad' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-slate-100 text-slate-600',
        tone === 'brand' && 'bg-brand-50 text-brand-700',
        tone === 'good' && 'bg-green-50 text-approve',
        tone === 'warn' && 'bg-amber-50 text-waitlist',
        tone === 'bad' && 'bg-red-50 text-decline',
      )}
    >
      {children}
    </span>
  );
}

export function ScoreBar({ value, max = 100, tone }: { value: number; max?: number; tone?: 'good' | 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = tone ?? (pct >= 70 ? 'good' : pct >= 55 ? 'warn' : 'bad');
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full rounded-full', auto === 'good' && 'bg-approve', auto === 'warn' && 'bg-waitlist', auto === 'bad' && 'bg-decline')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
      {label}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const fmtLakh = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `₹${v.toFixed(v < 10 ? 1 : 0)}L`);
export const fmtKm = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} km`);
export const fmtInt = (v: number) => v.toLocaleString('en-IN');
export const fmtDate = (iso: string) => new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
