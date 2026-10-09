import React, { useEffect, useRef, useState } from 'react';
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { serverNowMs } from '../lib/api';
import { addDays, currentPlayDate, fmtDate, hourLabel } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { arrivable, hourSpan, isNight, PLAY_HOURS } from './format';
import { useNow, useRemote } from './hooks';
import { ArrivedIconBtn, RestoreIconBtn } from './QuickActions';
import { Btn, cx } from './ui';
import { useQuickActions } from './useQuickActions';
import type { AdminBooking } from './types';

const ROW = 56; // px per hour

const TONE = {
  paid: 'border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
  done: 'border-zinc-400 bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70',
  check: 'border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100',
  held: 'border-sky-500 bg-sky-50 text-sky-950 hover:bg-sky-100',
  blocked: 'border-zinc-500 bg-[repeating-linear-gradient(135deg,#f4f4f5,#f4f4f5_6px,#e4e4e7_6px,#e4e4e7_12px)] text-zinc-800 hover:brightness-95',
} as const;

const toneOf = (b: AdminBooking): keyof typeof TONE =>
  b.source === 'blocked'
    ? 'blocked'
    : b.status === 'pending_verification' || (b.needsReview && b.reviewFlags.length > 0)
      ? 'check'
      : b.status === 'held'
        ? 'held'
        : b.label === 'done'
          ? 'done'
          : 'paid';

/** Late and rain-delayed bookings have given their hours back: they are shown, but they do not take up the court. */
const releasedHours = (b: AdminBooking) => b.label === 'late' || b.label === 'rain_delay';

export const SchedulePage: React.FC = () => {
  const desk = useDesk();
  const now = useNow(30000); // re-render every 30 s so the "now" line moves
  const { q, problemDialog } = useQuickActions();
  const realToday = desk.config?.today ?? currentPlayDate(serverNowMs());
  const [date, setDate] = useState(realToday);
  const { data, error } = useRemote(`schedule-${date}`, () => adminApi.schedule(date), { intervalMs: 20000, version: desk.refreshKey });
  const courts = desk.config?.courts ?? [];
  const nowMarker = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const dayStart = Date.parse(`${date}T06:00:00+08:00`);
  const nowIdx = (serverNowMs() - dayStart) / 3_600_000;
  const showNow = date === realToday && nowIdx >= 0 && nowIdx < 24;

  useEffect(() => {
    if (!data || scrolledFor.current === date) return;
    scrolledFor.current = date;
    if (showNow) nowMarker.current?.scrollIntoView({ block: 'center' });
  }, [data, date, showNow]);

  const blocks = (courtId: string) =>
    (data?.bookings ?? [])
      .filter((b) => b.courtId === courtId)
      .map((b) => {
        const a = Math.max(0, (Date.parse(b.startAt) - dayStart) / 3_600_000);
        const z = Math.min(24, (Date.parse(b.endAt) - dayStart) / 3_600_000);
        return { b, a, z };
      })
      .filter(({ a, z }) => z > a);

  const bookedHours = (data?.bookings ?? []).reduce((sum, b) => {
    if (b.source === 'blocked' || releasedHours(b)) return sum;
    const a = Math.max(0, (Date.parse(b.startAt) - dayStart) / 3_600_000);
    const z = Math.min(24, (Date.parse(b.endAt) - dayStart) / 3_600_000);
    return sum + Math.max(0, z - a);
  }, 0);
  const isToday = date === realToday;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">Schedule</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{data ? `${bookedHours} of ${24 * courts.length} court-hours booked` : ' '}</p>
        </div>
        <div className="hidden sm:block">
          <Btn variant="primary" onClick={() => desk.addBooking({ date })}>
            <Plus className="h-4 w-4" /> Add booking
          </Btn>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Btn variant="outline" size="md" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))} className="!px-3">
          <ChevronLeft className="h-5 w-5" />
        </Btn>
        <label className="relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 focus-within:ring-2 focus-within:ring-[#15803D]">
          <CalendarDays className="h-4 w-4 text-[#15803D]" />
          <span className="truncate">{fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          {isToday && <span className="rounded-full bg-[#D2EE5E] px-2 py-0.5 font-sport text-[10px] font-extrabold uppercase tracking-wider text-zinc-950">Today</span>}
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Pick a date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Btn variant="outline" size="md" aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))} className="!px-3">
          <ChevronRight className="h-5 w-5" />
        </Btn>
        {!isToday && (
          <Btn variant="dark" onClick={() => setDate(realToday)} className="hidden xs:inline-flex">
            Today
          </Btn>
        )}
      </div>

      {error && !data && <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">{error.message}</div>}

      <div className="overflow-clip rounded-2xl border border-zinc-200 bg-white">
        {/* Court headings stay in view while the hours scroll */}
        <div className="sticky top-14 z-20 grid border-b border-zinc-200 bg-white/95 backdrop-blur" style={{ gridTemplateColumns: `3.5rem repeat(${courts.length || 2}, minmax(0, 1fr))` }}>
          <div />
          {courts.map((c) => (
            <div key={c.id} className="border-l border-zinc-100 px-2 py-2.5 text-center font-heading text-sm font-bold text-zinc-900">
              {c.name}
            </div>
          ))}
        </div>

        <div className="relative" style={{ height: ROW * 24 }}>
          {/* Hour rows: tap an empty one to book it */}
          {PLAY_HOURS.map((h, i) => (
            <div key={h} className="absolute inset-x-0 grid" style={{ top: i * ROW, height: ROW, gridTemplateColumns: `3.5rem repeat(${courts.length || 2}, minmax(0, 1fr))` }}>
              <div className="flex justify-end pr-2 pt-1 text-[11px] font-semibold text-zinc-400">
                <span className={cx(isNight(h) && 'text-indigo-400')}>{hourLabel(h)}</span>
              </div>
              {courts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => desk.addBooking({ courtId: c.id, date, hour: h })}
                  aria-label={`Add a booking on ${c.name} at ${hourLabel(h)}`}
                  className={cx(
                    'group flex items-center justify-center border-l border-t border-zinc-100 transition-colors cursor-pointer',
                    'hover:bg-emerald-50/70 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]',
                    isNight(h) ? 'bg-zinc-50/80' : 'bg-white',
                    i % 6 === 0 && 'border-t-zinc-200'
                  )}
                >
                  <Plus className="h-4 w-4 text-[#15803D] opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" />
                </button>
              ))}
            </div>
          ))}

          {/* Bookings sit on top, one lane per court */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-14 grid" style={{ gridTemplateColumns: `repeat(${courts.length || 2}, minmax(0, 1fr))` }}>
            {courts.map((c) => (
              <div key={c.id} className="relative">
                {/* Late bookings first, so a booking made for the freed hours sits on top of them */}
                {blocks(c.id)
                  .filter(({ b }) => b.label === 'late')
                  .map(({ b, a, z }) => {
                    // The dashed outline shows the hours that reopened and lets taps through to the empty cells;
                    // only the first hour carries the guest name and the Restore button.
                    const head = Math.min(ROW - 4, (z - a) * ROW - 4);
                    return (
                      <div
                        key={b.code}
                        style={{ top: a * ROW + 2, height: (z - a) * ROW - 4 }}
                        className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-amber-500 bg-amber-100/50"
                      >
                        <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center overflow-hidden rounded-md bg-amber-50/90" style={{ height: head }}>
                          <button
                            type="button"
                            onClick={() => desk.openBooking(b.code)}
                            aria-label={`${b.customerName}, Late, ${hourSpan(b.hour, b.hours)}. Open booking`}
                            className="h-full min-w-0 flex-1 cursor-pointer px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]"
                          >
                            <span className="block truncate text-[13px] font-bold leading-tight text-amber-950">{b.customerName}</span>
                            <span className="mt-0.5 inline-block rounded bg-amber-500 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">Late</span>
                          </button>
                          <RestoreIconBtn b={b} q={q} className="mr-0.5" />
                        </div>
                        {z - a > 1 && (
                          <span className="pointer-events-none absolute inset-x-2 text-[10px] font-medium leading-tight text-amber-800/80" style={{ top: head + 4 }}>
                            {hourSpan(b.hour, b.hours)} · hours reopened
                          </span>
                        )}
                      </div>
                    );
                  })}
                {blocks(c.id)
                  .filter(({ b }) => b.label !== 'late')
                  .map(({ b, a, z }) => {
                    const tone = toneOf(b);
                    const tall = z - a >= 1.5;
                    const canArrive = arrivable(b, now);
                    return (
                      <div
                        key={b.code}
                        style={{ top: a * ROW + 2, height: (z - a) * ROW - 4 }}
                        className={cx('pointer-events-auto absolute inset-x-1 overflow-hidden rounded-lg border-l-4 shadow-xs ring-1 ring-black/5 transition', TONE[tone])}
                      >
                        <button
                          type="button"
                          onClick={() => desk.openBooking(b.code)}
                          className={cx(
                            'block h-full w-full cursor-pointer px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]',
                            canArrive && 'pr-[3.1rem]'
                          )}
                        >
                          <span className="flex items-center gap-1 text-[13px] font-bold leading-tight">
                            {b.source === 'blocked' && <Ban className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{b.customerName}</span>
                          </span>
                          <span className="block truncate text-[11px] font-medium leading-tight opacity-75">{hourSpan(b.hour, b.hours)}</span>
                          {tall && (tone === 'check' || tone === 'held') && (
                            <span className="mt-1 inline-block rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                              {tone === 'check' ? (b.status === 'pending_verification' ? 'Needs check' : 'Check payment') : 'Paying now'}
                            </span>
                          )}
                        </button>
                        {canArrive && <ArrivedIconBtn b={b} q={q} now={now} className="absolute right-0.5 top-0.5" />}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          {showNow && (
            <div ref={nowMarker} className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowIdx * ROW }}>
              <div className="relative h-0.5 bg-[#15803D]">
                <span className="absolute -top-2.5 left-1 rounded-full bg-[#15803D] px-1.5 py-0.5 font-sport text-[9px] font-extrabold uppercase tracking-wider text-white">Now</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-500" aria-label="Legend">
        {[
          ['bg-emerald-600', 'Paid'],
          ['bg-zinc-400', 'Done'],
          ['bg-amber-500', 'Needs a look'],
          ['bg-sky-500', 'Player is paying'],
          ['bg-zinc-500', 'Blocked'],
        ].map(([dot, label]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className={cx('h-2.5 w-2.5 rounded-sm', dot)} /> {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed border-amber-500" /> Late (hours reopened)
        </li>
        <li className="text-indigo-400">Night Owl hours are shaded</li>
      </ul>
      {problemDialog}
    </div>
  );
};
