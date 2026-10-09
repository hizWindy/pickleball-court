import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Phone } from 'lucide-react';
import { COURT_DETAILS } from '../../data/mockData';
import { fmtDate } from '../../lib/time';
import { smsHref } from './helpers';
import { cx } from './ui';

/** Pieces shared by the booking sheet and the reschedule sheet. */

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-xl font-bold tracking-tight text-zinc-950">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-sm font-semibold text-zinc-800">{children}</h4>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-zinc-800">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}

// ── Month calendar ────────────────────────────────────────────────────────────
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const clampMonth = (month: string, min: string, max: string) => {
  const lo = min.slice(0, 7);
  const hi = max.slice(0, 7);
  return month < lo ? lo : month > hi ? hi : month;
};

/** Pick a day between `min` and `max` (both YYYY-MM-DD, inclusive). `marked` gets a small dot (e.g. "your current date"). */
export function Calendar({
  min, max, selected, today, marked, onPick,
}: {
  min: string;
  max: string;
  selected: string | null;
  today?: string;
  marked?: string;
  onPick: (d: string) => void;
}) {
  const [month, setMonth] = useState(() => clampMonth((selected ?? marked ?? min).slice(0, 7), min, max)); // YYYY-MM
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const canPrev = month > min.slice(0, 7);
  const canNext = month < max.slice(0, 7);

  return (
    <div className="rounded-3xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-900" aria-live="polite">{fmtDate(`${month}-01`, { month: 'long', year: 'numeric' })}</span>
        <div className="flex gap-1">
          <button type="button" disabled={!canPrev} onClick={() => shiftMonth(-1)} className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" disabled={!canNext} onClick={() => shiftMonth(1)} className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-zinc-400">
        {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, '0')}`;
          const out = d < min || d > max;
          const isSel = d === selected;
          const isToday = d === today;
          const isMarked = d === marked;
          return (
            <button
              key={d}
              type="button"
              disabled={out}
              onClick={() => onPick(d)}
              aria-label={`${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${isMarked ? ' (your current date)' : ''}`}
              aria-pressed={isSel}
              className={cx(
                'relative mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition cursor-pointer',
                out && 'cursor-not-allowed text-zinc-300',
                !out && !isSel && 'text-zinc-800 hover:bg-emerald-50',
                isSel && 'bg-[#15803D] text-white shadow-sm',
                isToday && !isSel && 'ring-1 ring-[#15803D] text-[#15803D]'
              )}
            >
              {i + 1}
              {isMarked && <span aria-hidden className={cx('absolute bottom-1 h-1 w-1 rounded-full', isSel ? 'bg-white' : 'bg-amber-500')} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Reaching the host ─────────────────────────────────────────────────────────
export function HostActions({ code, message, className }: { code: string; message?: string; className?: string }) {
  const linkClass = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200';
  return (
    <div className={cx('flex gap-2', className)}>
      <a href={`tel:${COURT_DETAILS.contactNumber}`} className={linkClass}>
        <Phone className="h-4 w-4" /> Call host
      </a>
      <a href={smsHref(message ?? `Hi! About booking ${code}: `)} className={linkClass}>
        <MessageSquare className="h-4 w-4" /> Text host
      </a>
    </div>
  );
}
