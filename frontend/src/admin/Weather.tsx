import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CheckCircle2, CloudOff, CloudRain, Minus, Plus, RefreshCw, Search, Sun } from 'lucide-react';
import { errorMessage, serverNowMs } from '../lib/api';
import { addDays, currentPlayDate, fmtDate, fmtTime, hourLabel } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { clock, hourSpan, manilaHour, PLAY_HOURS, when } from './format';
import { useNow, useRemote } from './hooks';
import { rainMessage } from './messages';
import { HOUR_MS, rainFill, upcomingHours } from './forecast';
import { ContactBtns } from './QuickActions';
import { Btn, Card, CopyBtn, cx, Dialog, ErrorNote, Field, Label, SelectInput, TextInput } from './ui';
import { useQuickActions, type QuickApi } from './useQuickActions';
import type { AdminBooking, RainDelayPreview, RainRisk, WeatherReport } from './types';

/** A stretch of the play day: "Saturday, 2 PM for 5 hours". Hours after midnight belong to the previous day's date. */
interface Win {
  date: string;
  fromHour: number;
  hours: number;
}
interface Seed {
  win: Win;
  nonce: number;
}

const NOTES = ['Heavy rain', 'Thunderstorm', 'Flooded court'];
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short' });
const dayNumFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', day: 'numeric' });
/** "Thu 8" (the date order differs between locales, so it is put together here) */
const dayLabel = (ms: number) => `${weekdayFmt.format(ms)} ${dayNumFmt.format(ms)}`;

/** The longest a rain delay can run from this hour without leaving the play day (which ends at 6 AM). */
const maxHours = (fromHour: number) => 24 - PLAY_HOURS.indexOf(fromHour);

/** The window that covers all of these bookings, from the first start to the last finish. */
function windowFor(bookings: AdminBooking[]): Win {
  const start = Math.min(...bookings.map((b) => Date.parse(b.startAt)));
  const end = Math.max(...bookings.map((b) => Date.parse(b.endAt)));
  const first = bookings.find((b) => Date.parse(b.startAt) === start) ?? bookings[0];
  const fromHour = manilaHour(start);
  const hourStart = start - (start % HOUR_MS); // Manila is a whole number of hours from UTC, so this is the top of the hour
  return { date: first.playDate, fromHour, hours: Math.max(1, Math.min(maxHours(fromHour), Math.ceil((end - hourStart) / HOUR_MS))) };
}

/** Starts at this hour, for a few hours. */
function defaultWindow(): Win {
  const nowMs = serverNowMs();
  const fromHour = manilaHour(nowMs);
  return { date: currentPlayDate(nowMs), fromHour, hours: Math.min(4, maxHours(fromHour)) };
}

const winText = (w: Win) => `${fmtDate(w.date)} · ${hourSpan(w.fromHour, w.hours)}`;

const Heading: React.FC<{ id: string; title: string; note?: React.ReactNode }> = ({ id, title, note }) => (
  <div className="mb-3">
    <h2 id={id} className="font-heading text-lg font-bold tracking-tight text-zinc-950">
      {title}
    </h2>
    {note && <p className="mt-0.5 text-sm text-zinc-500">{note}</p>}
  </div>
);

export const WeatherPage: React.FC = () => {
  const desk = useDesk();
  const now = useNow(30000);
  const { q, problemDialog } = useQuickActions();
  const { report, loading } = desk.weather;
  const [seed, setSeed] = useState<Seed | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const waitingRef = useRef<HTMLElement>(null);
  const { refreshWeather } = desk;

  // Opening the tab asks for a fresh look (the server still only calls the weather service every 15 minutes).
  useEffect(() => {
    refreshWeather();
  }, [refreshWeather]);

  const callFor = (win: Win) => {
    setSeed({ win, nonce: Date.now() });
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const waiting = desk.counts?.rainDelay ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">Weather</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {report?.available && report.updatedAt ? `Forecast checked ${fmtTime(report.updatedAt)}` : 'Rain forecast and rain delays'}
          </p>
        </div>
        <Btn onClick={() => refreshWeather()} aria-label="Refresh the forecast">
          <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Btn>
      </div>

      {waiting > 0 && (
        <button
          type="button"
          onClick={() => waitingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="group flex w-full items-center gap-3 rounded-2xl border border-sky-300 bg-sky-50 p-3.5 text-left transition hover:bg-sky-100/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 font-heading font-bold text-white">{waiting}</span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-sky-950">
            {waiting === 1 ? '1 guest is waiting to rebook' : `${waiting} guests are waiting to rebook`}
            <span className="block text-xs font-medium text-sky-900/80">Send them their link or undo the delay.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 rotate-90 text-sky-800" />
        </button>
      )}

      <section aria-labelledby="forecast-h">
        <Heading id="forecast-h" title="Next 48 hours" />
        <ForecastCard report={report} loading={loading} now={now} onRetry={refreshWeather} />
      </section>

      {report?.available && (
        <section aria-labelledby="risk-h">
          <Heading id="risk-h" title="Bookings in the rain" note={`Paid bookings in hours with a ${report.warnPercent}% or higher chance of rain.`} />
          <RainRisks report={report} onCall={callFor} />
        </section>
      )}

      <section ref={formRef} aria-labelledby="delay-h" className="scroll-mt-20">
        <Heading
          id="delay-h"
          title="Call a rain delay"
          note="Guests give their hours back and pick a new time themselves. Nothing is cancelled or refunded."
        />
        <RainDelayForm key={seed?.nonce ?? 0} seed={seed} />
      </section>

      <section ref={waitingRef} aria-labelledby="waiting-h" className="scroll-mt-20">
        <WaitingList q={q} />
      </section>
      {problemDialog}
    </div>
  );
};

// ── Forecast ──────────────────────────────────────────────────────────────────
const ForecastCard: React.FC<{ report: WeatherReport | null; loading: boolean; now: number; onRetry: () => void }> = ({ report, loading, now, onRetry }) => {
  if (loading && !report) return <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />;
  if (!report || !report.available) {
    return (
      <Card className="flex items-start gap-3 p-4">
        <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Forecast unavailable</p>
          <p className="mt-0.5 text-sm text-zinc-500">The weather service can't be reached right now. You can still call a rain delay by hand below.</p>
          <Btn size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Btn>
        </div>
      </Card>
    );
  }
  return <ForecastStrip report={report} now={now} />;
};

const ForecastStrip: React.FC<{ report: WeatherReport; now: number }> = ({ report, now }) => {
  const hours = useMemo(() => upcomingHours(report, now).slice(0, 48), [report, now]);
  const [active, setActive] = useState<number | null>(null);
  const warn = report.warnPercent;
  const shown = active !== null ? hours[active] : null;

  if (hours.length === 0) {
    return <Card className="p-4 text-sm text-zinc-500">No forecast hours to show yet.</Card>;
  }

  const cellWhen = (i: number) => {
    const ms = Date.parse(hours[i].at);
    return `${dayLabel(ms)} ${hourLabel(manilaHour(ms))}`;
  };
  const cellLabel = (i: number) => `${cellWhen(i)}: ${hours[i].probability}% chance of rain, ${hours[i].mm.toFixed(1)} mm expected`;

  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">Chance of rain by the hour. Numbers show hours at {warn}% or more.</p>

      <div
        className="-mx-4 mt-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        tabIndex={0}
        role="group"
        aria-label="Hourly chance of rain for the next 48 hours. Scroll sideways for later hours."
      >
        <ul className="flex w-max items-end gap-[3px]">
          {hours.map((h, i) => {
            const ms = Date.parse(h.at);
            const newDay = i === 0 || dayLabel(ms) !== dayLabel(Date.parse(hours[i - 1].at));
            const p = h.probability;
            return (
              <React.Fragment key={h.at}>
                {newDay && (
                  <li aria-hidden className="flex h-[4.6rem] w-9 shrink-0 flex-col items-center justify-center border-l border-zinc-200 text-center first:border-l-0">
                    <span className="text-[11px] font-bold uppercase text-zinc-500">{weekdayFmt.format(ms)}</span>
                    <span className="font-heading text-sm font-bold text-zinc-900">{dayNumFmt.format(ms)}</span>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    onClick={() => setActive(active === i ? null : i)}
                    aria-pressed={active === i}
                    aria-label={cellLabel(i)}
                    title={cellLabel(i)}
                    className={cx(
                      'flex w-11 cursor-pointer flex-col items-center gap-1 rounded-lg pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
                      active === i && 'bg-zinc-100'
                    )}
                  >
                    <span className="h-3 text-[9px] font-extrabold uppercase leading-3 tracking-wider text-[#15803D]">{i === 0 ? 'Now' : ''}</span>
                    <span className="text-[11px] font-semibold leading-none text-zinc-600">{hourLabel(manilaHour(ms))}</span>
                    <span
                      className={cx(
                        'flex h-9 w-full items-center justify-center rounded-md text-[12px] font-bold tabular-nums',
                        p >= 55 ? 'text-white' : 'text-sky-950',
                        i === 0 && 'ring-2 ring-zinc-900 ring-offset-1'
                      )}
                      style={{ backgroundColor: rainFill(p) }}
                    >
                      {p >= warn ? `${p}%` : ''}
                    </span>
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </div>

      <p className="mt-2 min-h-5 text-sm text-zinc-700" aria-live="polite">
        {shown && active !== null ? (
          <>
            <strong className="font-semibold text-zinc-950">{cellWhen(active)}</strong>
            {`: ${shown.probability}% chance of rain, ${shown.mm.toFixed(1)} mm expected`}
          </>
        ) : (
          <span className="text-zinc-400">Tap an hour for details. Swipe sideways for later.</span>
        )}
      </p>
    </Card>
  );
};

// ── Bookings in the rain ──────────────────────────────────────────────────────
const RainRisks: React.FC<{ report: WeatherReport; onCall: (win: Win) => void }> = ({ report, onCall }) => {
  const desk = useDesk();
  const groups = useMemo(() => {
    const byDay = new Map<string, RainRisk[]>();
    for (const r of report.atRisk) byDay.set(r.booking.playDate, [...(byDay.get(r.booking.playDate) ?? []), r]);
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, risks]) => [date, [...risks].sort((a, b) => a.booking.startAt.localeCompare(b.booking.startAt))] as const);
  }, [report]);

  if (groups.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-zinc-600">
        <Sun className="h-5 w-5 shrink-0 text-amber-500" /> No paid bookings fall in forecast rain over the next few days.
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-zinc-100 overflow-hidden">
      {groups.map(([date, risks]) => (
        <div key={date} className="pb-4 pt-4">
          <div className="flex items-center justify-between gap-3 px-4">
            <h3 className="font-heading text-sm font-bold text-zinc-950">{fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
            <span className="text-xs text-zinc-500">{risks.length === 1 ? '1 booking' : `${risks.length} bookings`}</span>
          </div>
          <ul className="mt-1 px-2">
            {risks.map(({ booking: b, peak }) => (
              <li key={b.code}>
                <button
                  type="button"
                  onClick={() => desk.openBooking(b.code)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
                >
                  <span className="w-24 shrink-0 font-heading text-sm font-bold text-zinc-950">{hourSpan(b.hour, b.hours)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{b.customerName}</span>
                    <span className="block truncate text-xs text-zinc-500">{b.courtName}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold tabular-nums text-sky-900" aria-label={`${peak}% chance of rain`}>
                    {peak}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 pt-2">
            <Btn variant="dark" className="w-full" onClick={() => onCall(windowFor(risks.map((r) => r.booking)))}>
              <CloudRain className="h-4 w-4" /> Call rain delay for this window
            </Btn>
          </div>
        </div>
      ))}
    </Card>
  );
};

// ── Call a rain delay ─────────────────────────────────────────────────────────
const RainDelayForm: React.FC<{ seed: Seed | null }> = ({ seed }) => {
  const desk = useDesk();
  const [win, setWinState] = useState<Win>(() => seed?.win ?? defaultWindow());
  const [note, setNote] = useState('Heavy rain');
  const [preview, setPreview] = useState<RainDelayPreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<{ moved: AdminBooking[]; asked: number; win: Win } | null>(null);

  // Changing the window makes the last preview stale, so it goes away.
  const change = (patch: Partial<Win>) => {
    const merged = { ...win, ...patch };
    merged.hours = Math.max(1, Math.min(merged.hours, maxHours(merged.fromHour)));
    setWinState(merged);
    setPreview(null);
    setProblem(null);
  };

  const loadPreview = useCallback(async (w: Win) => {
    setPreviewing(true);
    setProblem(null);
    setPreview(null);
    try {
      const data = await adminApi.rainDelayPreview(w.date, w.fromHour, w.hours);
      setPreview(data);
      setPicked(new Set(data.bookings.map((b) => b.code)));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }, []);

  // "Call rain delay for this window" on a rainy booking remounts the form with that window and shows who it would move.
  useEffect(() => {
    if (seed) loadPreview(seed.win);
  }, [seed, loadPreview]);

  const chosen = preview ? preview.bookings.filter((b) => picked.has(b.code)) : [];

  const callIt = async () => {
    if (!preview) return;
    setCalling(true);
    setProblem(null);
    try {
      const codes = chosen.map((b) => b.code);
      const res = await adminApi.rainDelay({ date: win.date, fromHour: win.fromHour, hours: win.hours, codes, note: note.trim() || undefined });
      setResult({ moved: res.moved, asked: codes.length, win });
      setPreview(null);
      setConfirming(false);
      desk.refresh();
      desk.notify(res.moved.length === 1 ? 'Rain delay called. 1 guest moved.' : `Rain delay called. ${res.moved.length} guests moved.`);
    } catch (e) {
      setConfirming(false);
      setProblem(errorMessage(e));
    } finally {
      setCalling(false);
    }
  };

  const toggle = (code: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  if (result) {
    const skipped = result.asked - result.moved.length;
    return (
      <div className="space-y-3">
        <Card className="border-sky-200 bg-sky-50 p-4">
          <p className="flex items-center gap-2 font-heading text-base font-bold text-sky-950">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-700" />
            {result.moved.length === 0 ? 'Nobody was moved' : result.moved.length === 1 ? 'Rain delay called: 1 guest moved' : `Rain delay called: ${result.moved.length} guests moved`}
          </p>
          <p className="mt-1 text-sm text-sky-900">
            {result.moved.length > 0
              ? `${winText(result.win)}. Nothing is cancelled or refunded: each guest keeps their paid booking and picks a new time themselves. Send each one their link now.`
              : 'Those bookings had already finished or changed, so nothing was moved.'}
            {skipped > 0 && result.moved.length > 0 && ` ${skipped} ${skipped === 1 ? 'booking was' : 'bookings were'} left alone because ${skipped === 1 ? 'it had' : 'they had'} already finished.`}
          </p>
        </Card>
        {result.moved.map((b) => (
          <GuestRow key={b.code} b={b} />
        ))}
        <Btn className="w-full" onClick={() => setResult(null)}>
          Done
        </Btn>
      </div>
    );
  }

  const max = maxHours(win.fromHour);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Day"
            hint={win.fromHour < 6 ? `Runs into early ${fmtDate(addDays(win.date, 1), { weekday: 'short', month: 'short', day: 'numeric' })}` : fmtDate(win.date, { weekday: 'long' })}
          >
            {(id) => <TextInput id={id} type="date" value={win.date} onChange={(e) => e.target.value && change({ date: e.target.value })} className="appearance-none" />}
          </Field>
          <Field label="From">
            {(id) => (
              <SelectInput id={id} value={win.fromHour} onChange={(e) => change({ fromHour: Number(e.target.value) })}>
                {PLAY_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {clock(h)}
                    {h < 6 ? ' (after midnight)' : ''}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>

        <div>
          <Label>For how long</Label>
          <div className="mt-1.5 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-1.5">
            <button
              type="button"
              aria-label="One hour less"
              disabled={win.hours <= 1}
              onClick={() => change({ hours: win.hours - 1 })}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-5 w-5" />
            </button>
            <div className="text-center" aria-live="polite">
              <div className="font-heading text-lg font-bold leading-tight text-zinc-950">
                {win.hours} hour{win.hours > 1 ? 's' : ''}
              </div>
              <div className="text-xs text-zinc-500">{hourSpan(win.fromHour, win.hours)}</div>
            </div>
            <button
              type="button"
              aria-label="One hour more"
              disabled={win.hours >= max}
              onClick={() => change({ hours: win.hours + 1 })}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {win.hours < max && (
            <button
              type="button"
              onClick={() => change({ hours: max })}
              className="mt-2 min-h-9 cursor-pointer rounded-full bg-white px-3.5 text-[13px] font-semibold text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
            >
              Rest of the day
            </button>
          )}
        </div>

        <div>
          <Field label="Note" hint="Only you see this.">
            {(id) => <TextInput id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Heavy rain" />}
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NOTES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNote(n)}
                className={cx(
                  'min-h-9 cursor-pointer rounded-full px-3 text-xs font-semibold ring-1',
                  note === n ? 'bg-zinc-950 text-white ring-zinc-950' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <Btn variant="dark" size="lg" className="w-full" loading={previewing} onClick={() => loadPreview(win)}>
          <Search className="h-4 w-4" /> Preview who is affected
        </Btn>
        <p className="-mt-2 text-center text-xs text-zinc-500">Nothing changes until you confirm.</p>
      </Card>

      <ErrorNote>{problem}</ErrorNote>

      {preview && (
        <>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
              <div className="min-w-0">
                <h3 className="font-heading text-base font-bold text-zinc-950">
                  {preview.bookings.length === 0 ? 'Nobody is playing then' : preview.bookings.length === 1 ? '1 booking in this window' : `${preview.bookings.length} bookings in this window`}
                </h3>
                <p className="text-xs text-zinc-500">{winText(win)}</p>
              </div>
              {preview.bookings.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPicked(chosen.length === preview.bookings.length ? new Set() : new Set(preview.bookings.map((b) => b.code)))}
                  className="min-h-11 shrink-0 cursor-pointer rounded-lg px-2 text-sm font-semibold text-[#15803D] hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
                >
                  {chosen.length === preview.bookings.length ? 'Untick all' : 'Tick all'}
                </button>
              )}
            </div>
            {preview.bookings.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-zinc-500">No paid bookings are playing in that window, so a rain delay would not move anyone.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
                {preview.bookings.map((b) => (
                  <li key={b.code}>
                    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-zinc-50">
                      <input type="checkbox" checked={picked.has(b.code)} onChange={() => toggle(b.code)} className="h-5 w-5 shrink-0 cursor-pointer accent-[#15803D]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-900">{b.customerName}</span>
                        <span className="block text-xs text-zinc-500">
                          {b.courtName} · {b.playDate === win.date ? hourSpan(b.hour, b.hours) : when(b)}
                        </span>
                        <span className="block text-xs text-zinc-500">{b.customerPhone || 'No phone number'}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {preview.bookings.length > 0 && (
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg lg:bottom-4">
              <Btn variant="dark" size="lg" className="w-full" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
                <CloudRain className="h-5 w-5" /> {chosen.length === 0 ? 'Tick at least one booking' : `Call rain delay for ${chosen.length} ${chosen.length === 1 ? 'booking' : 'bookings'}`}
              </Btn>
              <p className="mt-1.5 text-center text-xs text-zinc-500">Nothing is cancelled or refunded.</p>
            </div>
          )}
        </>
      )}

      {confirming && (
        <Dialog
          title="Call a rain delay?"
          onClose={() => !calling && setConfirming(false)}
          actions={
            <>
              <Btn onClick={() => setConfirming(false)} disabled={calling}>
                Not yet
              </Btn>
              <Btn variant="dark" loading={calling} onClick={callIt}>
                Call rain delay
              </Btn>
            </>
          }
        >
          <p>
            {chosen.length === 1 ? '1 booking' : `${chosen.length} bookings`} on {winText(win)} will give their hours back right now.
          </p>
          <p>
            Nothing is cancelled or refunded. Each guest keeps their paid booking and picks a new time themselves (free, and it doesn't use their one reschedule). You'll get a message to send each of them next.
          </p>
        </Dialog>
      )}
    </div>
  );
};

// ── A guest to message ────────────────────────────────────────────────────────
/** One rain-delayed guest, with the message ready to send. */
const GuestRow: React.FC<{ b: AdminBooking; onOpen?: () => void; onUndo?: () => void }> = ({ b, onOpen, onUndo }) => {
  const message = rainMessage(b);
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full items-center gap-2 rounded-lg text-left enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-base font-bold text-zinc-950">{b.customerName}</span>
          <span className="block text-sm text-zinc-600">
            {b.courtName} · {when(b)}
          </span>
        </span>
        {onOpen && <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" />}
      </button>
      {!b.customerPhone && <p className="mt-2 text-xs text-zinc-500">No phone number saved. Copy the message and send it on Messenger instead.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ContactBtns b={b} message={message} />
        <CopyBtn text={message} label="Copy message" className={onUndo ? '!px-3' : 'col-span-2'} />
        {onUndo && (
          <Btn onClick={onUndo}>
            Undo
          </Btn>
        )}
      </div>
    </Card>
  );
};

// ── Waiting to rebook ─────────────────────────────────────────────────────────
const WaitingList: React.FC<{ q: QuickApi }> = ({ q }) => {
  const desk = useDesk();
  const now = useNow(30000);
  const [undoing, setUndoing] = useState<AdminBooking | null>(null);
  const { data, error } = useRemote('rain-waiting', () => adminApi.list({ label: 'rain_delay', sort: 'start_asc', pageSize: 50 }), {
    intervalMs: 30000,
    version: desk.refreshKey,
  });

  return (
    <>
      <Heading
        id="waiting-h"
        title={data && data.total > 0 ? `Waiting to rebook (${data.total})` : 'Waiting to rebook'}
        note="These guests gave their hours back and haven't picked a new time yet. They do it on the site with the link in your message."
      />
      {error && !data && <Card className="p-4 text-sm text-zinc-600">{error.message}</Card>}
      {!data && !error && <div className="h-24 animate-pulse rounded-2xl bg-zinc-100" />}
      {data && data.items.length === 0 && (
        <Card className="p-4 text-sm text-zinc-500">Nobody is waiting. After a rain delay, guests who haven't picked a new time show up here.</Card>
      )}
      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((b) => (
            <li key={b.code}>
              {/* Once the original time has passed there is nothing to put back; they can still pick a new time. */}
              <GuestRow b={b} onOpen={() => desk.openBooking(b.code)} onUndo={Date.parse(b.endAt) > now ? () => setUndoing(b) : undefined} />
              {Date.parse(b.endAt) <= now && <p className="mt-1.5 px-1 text-xs text-zinc-500">Their original time has passed. They can still pick a new one.</p>}
            </li>
          ))}
        </ul>
      )}

      {undoing && (
        <Dialog
          title={`Put ${undoing.customerName} back?`}
          onClose={() => setUndoing(null)}
          actions={
            <>
              <Btn onClick={() => setUndoing(null)}>Not yet</Btn>
              <Btn
                variant="dark"
                loading={q.busy === `restore:${undoing.code}`}
                onClick={() => {
                  q.restore(undoing);
                  setUndoing(null);
                }}
              >
                Undo rain delay
              </Btn>
            </>
          }
        >
          <p>
            This puts the booking back on {undoing.courtName}, {when(undoing)}, and takes those hours off sale again.
          </p>
          <p>If someone has booked those hours since, nothing changes and you'll be told.</p>
        </Dialog>
      )}
    </>
  );
};
