import React, { useState } from 'react';
import { hourLabel } from '../lib/time';
import { cx } from './ui';
import { PLAY_HOURS } from './format';

// Small hand-built charts: no chart library, so they match the rest of the site exactly,
// stay crisp on phones and add nothing to the bundle.

export interface Column {
  key: string;
  value: number;
  title: string; // shown in the readout while this column is active
  detail: string;
  emphasis?: boolean; // e.g. today
}

export const ColumnChart: React.FC<{
  columns: Column[];
  tone?: 'light' | 'dark';
  height?: number;
  /** Text under the first / middle / last column. */
  axis?: [string, string, string];
  maxLabel?: string;
  summary: { title: string; detail: string };
  ariaLabel: string;
  /** Stretch to fill a taller parent (the chart area grows, `height` becomes its minimum). */
  fill?: boolean;
}> = ({ columns, tone = 'light', height = 132, axis, maxLabel, summary, ariaLabel, fill }) => {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...columns.map((c) => c.value));
  const dark = tone === 'dark';
  const shown = active !== null ? columns[active] : summary;

  return (
    <div className={fill ? 'flex h-full flex-col' : undefined}>
      <div className="mb-3 flex min-h-[2.25rem] items-baseline justify-between gap-3" aria-live="polite">
        <span className={cx('text-[13px] font-semibold', dark ? 'text-white' : 'text-zinc-900')}>{shown.title}</span>
        <span className={cx('text-[13px] tabular-nums', dark ? 'text-zinc-400' : 'text-zinc-500')}>{shown.detail}</span>
      </div>

      <div role="img" aria-label={ariaLabel} className={cx('relative', fill && 'flex-1')} style={fill ? { minHeight: height } : { height }}>
        {[0, 50, 100].map((p) => (
          <div key={p} className={cx('absolute inset-x-0 border-t', dark ? 'border-white/10' : 'border-zinc-100', p === 0 && (dark ? 'border-white/25' : 'border-zinc-200'))} style={{ bottom: `${p}%` }} />
        ))}
        {maxLabel && (
          <span className={cx('absolute -top-0.5 left-0 -translate-y-full text-[10px] font-medium tabular-nums', dark ? 'text-zinc-500' : 'text-zinc-400')}>{maxLabel}</span>
        )}
        <div className="absolute inset-0 flex items-end gap-[2px]" onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}>
          {columns.map((c, i) => {
            const pct = (c.value / max) * 100;
            const on = active === i;
            return (
              <div
                key={c.key}
                className="flex h-full min-w-0 flex-1 cursor-default items-end"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              >
                <div
                  className={cx(
                    'w-full rounded-t-[3px] transition-[background-color,opacity] duration-150',
                    c.value === 0
                      ? dark ? 'bg-white/15' : 'bg-zinc-200'
                      : dark
                        ? on ? 'bg-white' : c.emphasis ? 'bg-[#CCFF00]' : 'bg-[#B4E600]/80'
                        : on ? 'bg-[#166534]' : c.emphasis ? 'bg-[#15803D]' : 'bg-[#15803D]/70'
                  )}
                  style={{ height: c.value === 0 ? 2 : `max(3px, ${pct}%)` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {axis && (
        <div className={cx('mt-2 flex justify-between text-[11px] font-medium', dark ? 'text-zinc-500' : 'text-zinc-400')} aria-hidden>
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
          <span>{axis[2]}</span>
        </div>
      )}
      <ul className="sr-only">
        {columns.map((c) => (
          <li key={c.key}>
            {c.title}: {c.detail}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Seven labelled columns (Mon–Sun) for a weekly rhythm. */
export const LabelledColumns: React.FC<{ items: { label: string; value: number; display: string }[]; ariaLabel: string }> = ({ items, ariaLabel }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  const best = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
  const barRoom = 88; // px the tallest bar may use
  return (
    <div role="img" aria-label={ariaLabel} className="flex items-end gap-2">
      {items.map((i) => {
        const top = i.value > 0 && i === best;
        return (
          <div key={i.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" style={{ height: barRoom + 44 }}>
            <span className={cx('text-[11px] font-semibold', top ? 'text-[#15803D]' : 'text-zinc-500')}>{i.value ? i.display : ''}</span>
            <div
              className={cx('w-full rounded-t-md', i.value === 0 ? 'bg-zinc-200' : top ? 'bg-[#15803D]' : 'bg-[#15803D]/45')}
              style={{ height: i.value === 0 ? 2 : Math.max(4, Math.round((i.value / max) * barRoom)) }}
            />
            <span className={cx('text-xs font-semibold', top ? 'text-zinc-900' : 'text-zinc-500')}>{i.label}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Which start hours get booked. Rows read as morning / afternoon / evening / after midnight. */
export const HourGrid: React.FC<{ counts: number[] }> = ({ counts }) => {
  const max = Math.max(0, ...counts);
  const peak = max > 0 ? counts.indexOf(max) : -1;
  return (
    <div role="img" aria-label={peak >= 0 ? `Busiest start hour is ${hourLabel(peak)} with ${max} booked hours.` : 'No booked hours yet.'} className="grid grid-cols-6 gap-1.5">
      {PLAY_HOURS.map((h) => {
        const n = counts[h] ?? 0;
        const r = max ? n / max : 0;
        return (
          <div
            key={h}
            title={`${hourLabel(h)}: ${n} booked hour${n === 1 ? '' : 's'}`}
            className={cx(
              'flex aspect-[5/4] flex-col items-center justify-center rounded-lg text-center',
              n === 0 && 'bg-zinc-50 text-zinc-300 ring-1 ring-inset ring-zinc-100',
              n > 0 && r > 0.55 ? 'text-white' : n > 0 ? 'text-zinc-900' : '',
              h === peak && 'ring-2 ring-[#CCFF00] ring-offset-1 ring-offset-white'
            )}
            style={n > 0 ? { backgroundColor: `rgba(21, 128, 61, ${0.1 + 0.9 * r})` } : undefined}
          >
            <span className="text-[10px] font-semibold leading-none opacity-80">{hourLabel(h)}</span>
            <span className="mt-0.5 font-heading text-base font-bold leading-none tabular-nums">{n || '·'}</span>
          </div>
        );
      })}
    </div>
  );
};

export const RankBars: React.FC<{ rows: { label: string; sub?: string; value: number; display: string }[]; empty?: string }> = ({ rows, empty = 'Nothing yet.' }) => {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <p className="text-sm text-zinc-400">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold text-zinc-800">
              {r.label}
              {r.sub && <span className="ml-2 text-xs font-medium text-zinc-400">{r.sub}</span>}
            </span>
            <span className="font-heading font-bold tabular-nums text-zinc-950">{r.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-[#15803D]" style={{ width: `${Math.max(2, (r.value / total) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

export const StackedBar: React.FC<{ parts: { label: string; value: number; className: string }[] }> = ({ parts }) => {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-sm text-zinc-400">No online bookings in this period yet.</p>;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-zinc-600">
            <span className={cx('h-2.5 w-2.5 rounded-sm', p.className)} />
            <span className="flex-1">{p.label}</span>
            <span className="font-semibold tabular-nums text-zinc-900">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
