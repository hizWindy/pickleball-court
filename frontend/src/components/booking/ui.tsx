import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import type { BookingStatus } from '../../types';
import { STATUS_COPY } from '../../lib/pass';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const TONE_CLASSES = {
  green: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-100 text-amber-900 ring-amber-200',
  red: 'bg-red-100 text-red-800 ring-red-200',
  zinc: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
};

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const s = STATUS_COPY[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1', TONE_CLASSES[s.tone], className)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.tone === 'green' ? 'bg-emerald-600' : s.tone === 'amber' ? 'bg-amber-500' : s.tone === 'red' ? 'bg-red-500' : 'bg-zinc-400')} />
      {s.label}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; size?: 'md' | 'lg' };

export function PrimaryButton({ loading, size = 'lg', className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-2xl bg-[#15803D] font-semibold text-white shadow-sm shadow-emerald-900/20 transition',
        'hover:bg-[#166534] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300 cursor-pointer',
        size === 'lg' ? 'min-h-12 px-5 text-[15px]' : 'min-h-10 px-4 text-sm',
        className
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function SecondaryButton({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 transition',
        'hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 cursor-pointer',
        className
      )}
    >
      {children}
    </button>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older iOS without clipboard permission: fall back to a hidden input selection
      const input = document.createElement('input');
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition cursor-pointer',
        copied ? 'bg-emerald-600 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'
      )}
      aria-live="polite"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function InlineError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-100">
      {children}
    </div>
  );
}

/** Lock page scroll while a full-screen layer is open. */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
