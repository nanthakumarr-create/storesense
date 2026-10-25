// Small layout pieces used only on the applicant page.
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button, cx } from '../components/ui';

export function Section({ id, title, subtitle, action, children, className }: { id?: string; title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cx('rounded-xl border border-line bg-white', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Label / value rows; values right-aligned and tabular. */
export function KV({ rows }: { rows: { k: ReactNode; v: ReactNode; hint?: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="min-w-0 flex-1 text-sm text-muted">
            {r.k}
            {r.hint && <span className="block text-xs text-muted/80">{r.hint}</span>}
          </dt>
          <dd className={cx('tabular min-w-0 max-w-[60%] break-words text-right text-sm text-ink', r.strong && 'font-semibold')}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-muted">{children}</p>;
}

export function Collapsible({ title, count, children, defaultOpen = false }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-line bg-white">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left sm:px-5">
        <span className="text-sm font-semibold text-ink">
          {title}
          {count !== undefined && <span className="tabular ml-2 font-normal text-muted">{count}</span>}
        </span>
        <ChevronDown size={16} className={cx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line px-4 py-4 sm:px-5">{children}</div>}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label, variant = 'primary' }: { text: string; label: string; variant?: 'primary' | 'secondary' }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      variant={variant}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'fail');
        window.setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'ok' ? <Check size={15} /> : <Copy size={15} />}
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed: select the text below' : label}
    </Button>
  );
}

/** Thin neutral bar: brand blue for this applicant's value, grey otherwise. */
export function Bar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'grey' | 'warn' }) {
  const p = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full rounded-full', tone === 'brand' && 'bg-brand-600', tone === 'grey' && 'bg-slate-400', tone === 'warn' && 'bg-waitlist')} style={{ width: `${p}%` }} />
    </div>
  );
}
