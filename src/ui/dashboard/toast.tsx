// Small local toast stack for dashboard pages (no global provider needed).
import { useCallback, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cx } from '../components/ui';

export interface Toast {
  id: number;
  tone: 'good' | 'bad';
  title: string;
  body?: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list, { ...t, id }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[1500] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:w-96">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border bg-white p-3 text-sm shadow-lg',
            t.tone === 'good' ? 'border-green-200' : 'border-red-200',
          )}
        >
          {t.tone === 'good' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-approve" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-decline" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{t.title}</p>
            {t.body && <p className="mt-0.5 break-words text-xs text-muted">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
