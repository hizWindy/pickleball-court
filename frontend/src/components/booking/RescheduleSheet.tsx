import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, CalendarClock, Check, ChevronRight, Clock, CloudRain, Lock, Tag, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { device } from '../../lib/device';
import { normalizePhone } from '../../lib/phone';
import { addDays, afterMidnightNote, fmtDate, fmtSchedule, hourLabel, hourTimeLabel, hrsLabel, isNightHour, peso } from '../../lib/time';
import { useAvailability, useConfig } from '../../hooks/useBookingData';
import type { AppConfig, Availability, Booking, CourtConfig, RescheduleLookup, SlotAvailability, TimePeriod } from '../../types';
import { inputClass, PERIODS } from './helpers';
import { Calendar, Field, HostActions, StepTitle } from './shared';
import { cx, InlineError, PrimaryButton, SecondaryButton, useBodyScrollLock } from './ui';

export interface RescheduleSeed {
  /** Booking code to start from (e.g. from a text message link). */
  code?: string;
  /** This device's booking token, when it is the device that booked: no typing needed. */
  token?: string;
}

interface Props {
  seed: RescheduleSeed;
  onClose: () => void;
  /** The booking was moved: the app opens its pass. */
  onDone: (booking: Booking, token: string) => void;
}

type Step = 'find' | 'date' | 'time' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'find', label: 'Your booking' },
  { id: 'date', label: 'New date' },
  { id: 'time', label: 'New time' },
  { id: 'review', label: 'Confirm' },
];

/** "hpc abcd efgh" -> "HPC-ABCD-EFGH" while typing. */
function formatCode(raw: string): string {
  let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.startsWith('HPC')) c = c.slice(3);
  c = c.slice(0, 8);
  if (!c) return '';
  return c.length > 4 ? `HPC-${c.slice(0, 4)}-${c.slice(4)}` : `HPC-${c}`;
}
const CODE_RE = /^HPC-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// ── Which new slots can this booking move to? ─────────────────────────────────
interface CourtOption {
  court: CourtConfig;
  /** Every hour of the booking's length is open on this court. */
  free: boolean;
  /** What the booking's hours would cost here. */
  cost: number;
  /** This is the booking's own current court and start time. */
  same: boolean;
  /** Costs more than the booking already paid for court time (not allowed). */
  tooCostly: boolean;
  ok: boolean;
}

type SlotKind = 'ok' | 'current' | 'costs_more' | 'short' | 'held' | 'booked' | 'past';

interface SlotEval {
  slot: SlotAvailability;
  options: CourtOption[];
  kind: SlotKind;
  okCount: number;
  /** Cheapest allowed court is cheaper than what was paid (the difference isn't refunded). */
  cheaper: boolean;
}

/**
 * For every start time of the day: which courts are open for all of the booking's hours, what they'd cost,
 * and whether the move is allowed. The booking's own hours count as open (they're given up when it moves).
 * Hours after 5 AM roll into the next play day, so a late start looks at the next day's grid too.
 */
function evaluate(b: Booking, config: AppConfig, avail: Availability, nextAvail: Availability | null): SlotEval[] {
  const startMs = Date.parse(b.startAt);
  const endMs = Date.parse(b.endAt);
  const at = (i: number) => (i < 24 ? avail.slots[i] : nextAvail?.slots[i - 24]);
  const isOwn = (slot: SlotAvailability) => {
    const t = Date.parse(slot.startAt);
    return !b.weatherHold && slot.courts[b.courtId] === 'booked' && t >= startMs && t < endMs;
  };
  const isFree = (courtId: string, slot: SlotAvailability | undefined) =>
    !!slot && (slot.courts[courtId] === 'available' || (courtId === b.courtId && isOwn(slot)));

  return avail.slots.map((slot, i) => {
    const options: CourtOption[] = config.courts.map((court) => {
      let free = true;
      for (let k = 0; k < b.hours && free; k++) free = isFree(court.id, at(i + k));
      let cost = 0;
      for (let k = 0; k < b.hours; k++) cost += isNightHour((slot.hour + k) % 24) ? court.nightRate : court.dayRate;
      const same = !b.weatherHold && court.id === b.courtId && Date.parse(slot.startAt) === startMs;
      const tooCostly = cost > b.courtCost;
      return { court, free, cost, same, tooCostly, ok: free && !same && !tooCostly };
    });
    const ok = options.filter((o) => o.ok);
    const states = Object.values(slot.courts);
    let kind: SlotKind;
    if (ok.length) kind = 'ok';
    else if (options.some((o) => o.free && o.same) || isOwn(slot)) kind = 'current';
    else if (options.some((o) => o.free && o.tooCostly)) kind = 'costs_more';
    else if (states.every((s) => s === 'past')) kind = 'past';
    else if (states.some((s) => s === 'available')) kind = 'short';
    else if (states.some((s) => s === 'held')) kind = 'held';
    else kind = 'booked';
    return { slot, options, kind, okCount: ok.length, cheaper: ok.length > 0 && Math.min(...ok.map((o) => o.cost)) < b.courtCost };
  });
}

export const RescheduleSheet: React.FC<Props> = ({ seed, onClose, onDone }) => {
  const { config } = useConfig();
  useBodyScrollLock();

  const [step, setStep] = useState<Step>('find');
  const [code, setCode] = useState(formatCode(seed.code ?? ''));
  const [phone, setPhone] = useState(device.details()?.phone ?? '');
  const [touched, setTouched] = useState(false);
  const [finding, setFinding] = useState(false);
  const [auto, setAuto] = useState(!!(seed.code && seed.token)); // opened with this device's token: look it up right away
  const [findError, setFindError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<RescheduleLookup | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [period, setPeriod] = useState<TimePeriod | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ booking: Booking; token: string } | null>(null);

  const booking = lookup?.booking ?? null;
  const hours = booking?.hours ?? 1;
  const state = booking?.reschedule;
  const canMove = state === 'open' || state === 'weather';
  const minHours = config?.rescheduleMinHours ?? 48;
  const phoneNormalized = normalizePhone(phone);
  const codeValid = CODE_RE.test(code);

  const find = useCallback(async (c: string, p?: string, t?: string) => {
    setFinding(true);
    setFindError(null);
    try {
      const res = await api.rescheduleFind(c, p, t);
      device.savePass(res.booking.code, res.accessToken); // so the pass opens on this device later
      setLookup(res);
    } catch (e) {
      setFindError(errorMessage(e));
    } finally {
      setFinding(false);
    }
  }, []);

  const autoLookup = useRef(false);
  useEffect(() => {
    if (autoLookup.current || !seed.code || !seed.token) return;
    autoLookup.current = true;
    find(seed.code, undefined, seed.token).finally(() => setAuto(false));
  }, [seed.code, seed.token, find]);

  const closeOrDone = useCallback(() => (done ? onDone(done.booking, done.token) : onClose()), [done, onDone, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeOrDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOrDone]);

  // Live availability for the chosen day (plus the next one, for sessions that run past 5 AM).
  const needsAvailability = (step === 'time' || step === 'review') && !!booking && !done;
  const { data: avail, error: availError, refresh } = useAvailability(date, { enabled: needsAvailability });
  const { data: nextAvail } = useAvailability(date && hours > 1 ? addDays(date, 1) : null, { enabled: needsAvailability && hours > 1 });

  const grid = useMemo(
    () => (booking && config && avail ? evaluate(booking, config, avail, nextAvail) : null),
    [booking, config, avail, nextAvail]
  );
  const selected = grid?.find((e) => e.slot.hour === hour) ?? null;
  // Default court: the same one if it's open, otherwise the other. Also moves off a court that gets taken meanwhile.
  const preferred = selected?.options.find((o) => o.ok && o.court.id === booking?.courtId) ?? selected?.options.find((o) => o.ok) ?? null;
  const option = selected?.options.find((o) => o.ok && o.court.id === courtId) ?? preferred;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goBack = () => {
    if (done) return closeOrDone();
    if (stepIndex === 0) return onClose();
    setError(null);
    setStep(STEPS[stepIndex - 1].id);
  };

  const submitFind = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!codeValid || !phoneNormalized) {
      setTouched(true);
      return;
    }
    find(code, phoneNormalized);
  };

  const pickDate = (d: string) => {
    setError(null);
    if (d !== date) {
      setDate(d);
      setHour(null);
      setCourtId(null);
      setPeriod(null);
    }
    setTimeout(() => setStep('time'), 120);
  };

  const pickHour = (h: number) => {
    setError(null);
    setHour(h);
    setCourtId(null);
    setTimeout(() => setStep('review'), 120);
  };

  const confirm = async () => {
    if (!booking || !lookup || !date || hour == null || !option) return;
    setSubmitting(true);
    setError(null);
    try {
      const moved = await api.reschedule(
        { code: booking.code, customerPhone: phoneNormalized ?? undefined, courtId: option.court.id, date, hour },
        lookup.accessToken
      );
      setDone({ booking: moved, token: lookup.accessToken });
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      setError(errorMessage(e));
      if (c === 'slot_taken' || c === 'slot_past') {
        refresh();
        setHour(null);
        setCourtId(null);
        setStep('time');
      } else if (c === 'costs_more' || c === 'same_slot') {
        refresh();
        setStep('time');
      } else if (c === 'reschedule_date_out_of_range') {
        setStep('date');
      } else if (c === 'reschedule_used' || c === 'reschedule_too_late' || c === 'reschedule_unavailable') {
        setStep('find');
        find(booking.code, phoneNormalized ?? undefined, lookup.accessToken); // refresh what the booking can do now
      }
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    setError(null);
    if (step === 'find') {
      if (!lookup) return submitFind();
      if (!canMove) return onClose();
      // Start the calendar on the original date, kept inside the allowed range.
      return setStep('date');
    }
    if (step === 'date') return setStep('time');
    if (step === 'time') return setStep('review');
    return confirm();
  };

  const canContinue =
    step === 'find' ? !finding :
    step === 'date' ? !!date :
    step === 'time' ? selected?.kind === 'ok' :
    !!option?.ok && !submitting;

  const footerLabel =
    step === 'find' ? (!lookup ? 'Find my booking' : canMove ? 'Choose a new date' : 'Close') :
    step === 'review' ? 'Confirm new time' : 'Continue';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 30, stiffness: 340 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-zinc-50 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[28px] sm:shadow-2xl"
      >
        {/* Header */}
        <header className="shrink-0 border-b border-zinc-100 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={goBack} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 cursor-pointer" aria-label={stepIndex === 0 || done ? 'Close' : 'Back'}>
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <h2 id="reschedule-title" className="text-[15px] font-bold text-zinc-950">{done ? 'Booking moved' : 'Reschedule your booking'}</h2>
              {!done && (
                <p className="text-xs text-zinc-500">
                  Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].label}
                </p>
              )}
            </div>
            <button type="button" onClick={closeOrDone} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 cursor-pointer" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          {!done && (
            <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  tabIndex={-1}
                  disabled={i > stepIndex}
                  onClick={() => setStep(s.id)}
                  className={cx('h-1.5 rounded-full transition-colors', i <= stepIndex ? 'bg-[#15803D]' : 'bg-zinc-200', i < stepIndex && 'cursor-pointer')}
                />
              ))}
            </div>
          )}
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <motion.div key={done ? 'done' : step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
            {done ? (
              <MovedView booking={done.booking} />
            ) : step === 'find' ? (
              booking && lookup ? (
                <FoundView
                  lookup={lookup}
                  minHours={minHours}
                  onOther={() => { setLookup(null); setFindError(null); }}
                />
              ) : auto ? (
                <div className="py-16 text-center text-sm text-zinc-500" role="status">Finding your booking…</div>
              ) : (
                <FindForm
                  code={code}
                  onCode={(v) => setCode(formatCode(v))}
                  phone={phone}
                  onPhone={setPhone}
                  codeError={touched && !codeValid}
                  phoneError={touched && !phoneNormalized}
                  error={findError}
                  onSubmit={submitFind}
                />
              )
            ) : step === 'date' && booking && lookup ? (
              <div className="space-y-5">
                <StepTitle
                  title="Pick a new date"
                  subtitle={`Choose any day from ${fmtDate(lookup.earliestDate)} to ${fmtDate(lookup.latestDate)}.`}
                />
                <Calendar min={lookup.earliestDate} max={lookup.latestDate} selected={date} marked={booking.playDate} today={config?.today} onPick={pickDate} />
                <p className="flex items-center gap-2 text-xs text-zinc-500">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Your current date
                </p>
              </div>
            ) : step === 'time' && booking && date ? (
              <TimeStep
                booking={booking}
                date={date}
                grid={grid}
                error={availError?.message}
                selectedHour={hour}
                period={period}
                onPeriod={setPeriod}
                onPick={pickHour}
                onRetry={refresh}
              />
            ) : step === 'review' && booking && date && hour != null ? (
              <ReviewStep
                booking={booking}
                state={state}
                date={date}
                hour={hour}
                selected={selected}
                courtId={option?.court.id ?? null}
                onCourt={setCourtId}
                loading={!grid}
              />
            ) : null}
            {error && <div className="mt-4"><InlineError>{error}</InlineError></div>}
          </motion.div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-zinc-100 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {done ? (
            <PrimaryButton className="w-full" onClick={closeOrDone}>Open my new pass</PrimaryButton>
          ) : step === 'find' && lookup && !canMove ? (
            <SecondaryButton className="w-full" onClick={onClose}>Close</SecondaryButton>
          ) : (
            <PrimaryButton
              className="w-full shadow-md shadow-emerald-950/10 text-sm font-heading font-extrabold uppercase tracking-wider"
              disabled={!canContinue}
              loading={step === 'find' ? finding : submitting}
              onClick={next}
            >
              {footerLabel}
              {step !== 'review' && <ChevronRight className="h-4 w-4" />}
            </PrimaryButton>
          )}
        </footer>
      </motion.div>
    </div>
  );
};

// ── Step 1: find the booking ──────────────────────────────────────────────────
function FindForm({
  code, onCode, phone, onPhone, codeError, phoneError, error, onSubmit,
}: {
  code: string;
  onCode: (v: string) => void;
  phone: string;
  onPhone: (v: string) => void;
  codeError: boolean;
  phoneError: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <StepTitle title="Find your booking" subtitle="Enter your booking code and the mobile number you booked with." />
      <div className="space-y-4">
        <Field label="Booking code" error={codeError ? 'Enter the code from your pass, like HPC-AB12-CD34.' : undefined} hint="You can find it on your court pass or in your booking text.">
          <input
            type="text"
            value={code}
            onChange={(e) => onCode(e.target.value)}
            placeholder="HPC-AB12-CD34"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={13}
            className={cx(inputClass(codeError), 'font-mono tracking-wide')}
          />
        </Field>
        <Field label="Mobile number" error={phoneError ? 'Enter a valid PH mobile number, e.g. 0912 345 6789.' : undefined}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder="0912 345 6789"
            maxLength={16}
            className={inputClass(phoneError)}
          />
        </Field>
      </div>
      <InlineError>{error}</InlineError>
      {/* lets the keyboard's Go/Enter key submit */}
      <button type="submit" className="sr-only" tabIndex={-1}>Find my booking</button>
    </form>
  );
}

/** The booking we found, and what can be done with it. */
function FoundView({ lookup, minHours, onOther }: { lookup: RescheduleLookup; minHours: number; onOther: () => void }) {
  const { booking: b } = lookup;
  const sched = fmtSchedule(b.startAt, b.endAt);
  const state = b.reschedule;
  const hostMessage = `Hi! About booking ${b.code}: I'd like to ask about changing my time.`;

  return (
    <div className="space-y-5">
      <StepTitle title="Is this your booking?" />
      <div className="divide-y divide-zinc-100 rounded-3xl border border-zinc-200 bg-white text-sm">
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">Reservation no.</span>
            <span className="font-mono text-lg font-bold tracking-wide text-zinc-950">{b.code}</span>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{b.courtName}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
          <Fact label="Date" value={sched.day} sub={sched.note} />
          <Fact label="Time" value={sched.time} sub={hrsLabel(b.hours)} />
          <Fact label="Player" value={b.customerName} />
          <Fact label="Paid" value={peso(b.total)} sub={b.paddles ? 'Includes paddles' : undefined} />
        </div>
      </div>

      {state === 'weather' && (
        <div className="flex gap-3 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950 ring-1 ring-sky-200">
          <CloudRain className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          <p>
            The courts were closed for rain, so your session was moved. <strong>Moving it now is free and doesn't use your one reschedule.</strong>{' '}
            Pick any new time of the same length ({hrsLabel(b.hours)}).
          </p>
        </div>
      )}

      {state === 'open' && (
        <div className="space-y-3">
          <ul className="space-y-1.5 rounded-2xl bg-white p-4 text-sm text-zinc-700 ring-1 ring-zinc-200">
            <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" /> Same length: {hrsLabel(b.hours)}</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" /> New date between {fmtDate(lookup.earliestDate)} and {fmtDate(lookup.latestDate)}</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" /> A slot that costs {peso(b.courtCost)} or less</li>
          </ul>
          <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-100">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p><strong>You can only reschedule once.</strong> After this move your booking can't be changed again.</p>
          </div>
        </div>
      )}

      {state === 'used' && (
        <Blocked title="You've already used your one reschedule" code={b.code} message={hostMessage}>
          Each booking can be moved once. If something came up, message the host. Changes are at the host's discretion.
        </Blocked>
      )}
      {state === 'too_late' && (
        <Blocked title={`Rescheduling closes ${minHours} hours before your start time`} code={b.code} message={hostMessage}>
          Your session starts soon, so it can't be moved online. Message the host. Exceptions are at the host's discretion.
        </Blocked>
      )}
      {state === 'unavailable' && (
        <Blocked title="This booking can't be moved online" code={b.code} message={hostMessage}>
          {b.late
            ? 'It was marked Late, so the court was released. Please contact the host.'
            : b.arrived
            ? "You're already checked in for this session."
            : b.status !== 'confirmed'
            ? 'Only paid, upcoming bookings can be rescheduled.'
            : 'Please message the host if you need a change.'}
        </Blocked>
      )}

      <button type="button" onClick={onOther} className="min-h-11 text-sm font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline cursor-pointer">
        Not your booking? Look up another
      </button>
    </div>
  );
}

function Blocked({ title, code, message, children }: { title: string; code: string; message: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
      <p className="text-[15px] font-bold text-zinc-950">{title}</p>
      <p className="text-sm leading-relaxed text-zinc-600">{children}</p>
      <HostActions code={code} message={message} />
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="block font-semibold text-zinc-950">{value}</span>
      {sub && <span className="block text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

// ── Step 3: pick a new start time ─────────────────────────────────────────────
function TimeStep({
  booking, date, grid, error, selectedHour, period, onPeriod, onPick, onRetry,
}: {
  booking: Booking;
  date: string;
  grid: SlotEval[] | null;
  error?: string;
  selectedHour: number | null;
  period: TimePeriod | null;
  onPeriod: (p: TimePeriod) => void;
  onPick: (h: number) => void;
  onRetry: () => void;
}) {
  const firstOpen = grid?.find((e) => e.kind === 'ok')?.slot.period;
  const selectedPeriod = grid?.find((e) => e.slot.hour === selectedHour)?.slot.period;
  const active = period ?? selectedPeriod ?? firstOpen ?? 'morning';
  const slots = grid?.filter((e) => e.slot.period === active) ?? [];
  const openCount = (p: TimePeriod) => grid?.filter((e) => e.slot.period === p && e.kind === 'ok').length ?? 0;

  return (
    <div className="space-y-5">
      <StepTitle
        title="Pick a new start time"
        subtitle={`${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${hrsLabel(booking.hours)}, same length as your booking`}
      />
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-zinc-100 p-1.5">
        {PERIODS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPeriod(id)}
            className={cx(
              'flex min-h-11 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-semibold transition cursor-pointer',
              active === id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <Icon className={cx('h-4 w-4', active === id ? 'text-[#15803D]' : '')} />
            <span>{label}</span>
            {grid && <span className="text-[10px] font-medium text-zinc-400">{openCount(id)} open</span>}
          </button>
        ))}
      </div>

      {error && !grid ? (
        <div className="space-y-3 text-center">
          <InlineError>{error}</InlineError>
          <PrimaryButton size="md" onClick={onRetry}>Try again</PrimaryButton>
        </div>
      ) : !grid ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-zinc-100" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {slots.map((e) => {
              const isSel = e.slot.hour === selectedHour;
              const ok = e.kind === 'ok';
              return (
                <button
                  key={e.slot.hour}
                  type="button"
                  disabled={!ok}
                  onClick={() => onPick(e.slot.hour)}
                  aria-pressed={isSel}
                  className={cx(
                    'relative min-h-[68px] rounded-2xl border px-2 py-3 text-center transition cursor-pointer disabled:cursor-not-allowed',
                    ok && !isSel && 'border-zinc-200 bg-white text-zinc-900 hover:border-[#15803D] hover:shadow-xs',
                    ok && isSel && 'border-[#15803D] bg-[#15803D] text-white shadow-md shadow-emerald-900/20',
                    e.kind === 'current' && 'border-zinc-200 bg-zinc-50 text-zinc-500',
                    e.kind === 'costs_more' && 'border-amber-300 bg-amber-50/80 text-amber-950',
                    e.kind === 'short' && 'border-zinc-200 bg-zinc-50 text-zinc-500',
                    e.kind === 'held' && 'border-amber-300 bg-amber-50/80 text-amber-950',
                    e.kind === 'booked' && 'border-rose-300 bg-rose-50/90 text-rose-950',
                    e.kind === 'past' && 'border-transparent bg-zinc-100 text-zinc-400'
                  )}
                >
                  <span className="block text-[15px] font-bold leading-tight">{hourLabel(e.slot.hour)}</span>
                  <span
                    className={cx(
                      'mt-0.5 block text-[11px] font-medium leading-tight',
                      isSel && 'text-emerald-100',
                      ok && !isSel && (e.okCount > 1 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'),
                      e.kind === 'costs_more' && 'inline-flex items-center justify-center gap-0.5 font-semibold text-amber-800',
                      e.kind === 'booked' && 'inline-flex items-center justify-center gap-0.5 font-bold text-rose-700'
                    )}
                  >
                    {e.kind === 'ok' ? (
                      e.cheaper ? 'Cheaper slot' : e.okCount > 1 ? `${e.okCount} courts open` : '1 court left'
                    ) : e.kind === 'current' ? (
                      'Your booking'
                    ) : e.kind === 'costs_more' ? (
                      <><Tag className="inline h-2.5 w-2.5" /> Costs more</>
                    ) : e.kind === 'short' ? (
                      `Not free for ${hrsLabel(booking.hours)}`
                    ) : e.kind === 'held' ? (
                      'On hold'
                    ) : e.kind === 'booked' ? (
                      <><Lock className="inline h-2.5 w-2.5" /> Reserved</>
                    ) : (
                      'Passed'
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {active === 'night_owl' && (
            <p className="text-xs text-zinc-500">
              12 AM – 5 AM are the early hours of {fmtDate(addDays(date, 1))}. Night Owl rate applies 10 PM – 6 AM.
            </p>
          )}
          <p className="text-xs leading-relaxed text-zinc-500">
            Times are greyed out when a court isn't free for all {hrsLabel(booking.hours)}, or when the slot costs more than the {peso(booking.courtCost)} you paid for court time.
          </p>
        </>
      )}
    </div>
  );
}

// ── Step 4: choose the court and confirm ──────────────────────────────────────
function ReviewStep({
  booking, state, date, hour, selected, courtId, onCourt, loading,
}: {
  booking: Booking;
  state: Booking['reschedule'] | undefined;
  date: string;
  hour: number;
  selected: SlotEval | null;
  courtId: string | null;
  onCourt: (id: string) => void;
  loading: boolean;
}) {
  const from = fmtSchedule(booking.startAt, booking.endAt);
  const endHour = (hour + booking.hours) % 24;
  const toDay = afterMidnightNote(date, hour) ?? fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
  const toTime = `${hourTimeLabel(hour)} – ${hourTimeLabel(endHour)}`;
  const option = selected?.options.find((o) => o.court.id === courtId) ?? null;
  const cheaperBy = option ? booking.courtCost - option.cost : 0;

  return (
    <div className="space-y-5">
      <StepTitle title="Choose your court and confirm" subtitle="Check the new time. This is the last step." />

      <section>
        <h4 className="mb-2 text-sm font-semibold text-zinc-800">Court</h4>
        {loading || !selected ? (
          <div className="h-[72px] animate-pulse rounded-2xl bg-zinc-100" />
        ) : (
          <div className="space-y-2">
            {selected.options.map((o) => {
              const isSel = o.court.id === courtId && o.ok;
              return (
                <button
                  key={o.court.id}
                  type="button"
                  disabled={!o.ok}
                  onClick={() => onCourt(o.court.id)}
                  aria-pressed={isSel}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition cursor-pointer disabled:cursor-not-allowed',
                    isSel ? 'border-[#15803D] bg-emerald-50 ring-2 ring-emerald-200' : o.ok ? 'border-zinc-200 bg-white hover:border-emerald-300' : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2', isSel ? 'border-[#15803D] bg-[#15803D] text-white' : 'border-zinc-300')}>
                      {isSel && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <div>
                      <span className="block text-[15px] font-bold text-zinc-950">{o.court.name}</span>
                      <span className="text-xs text-zinc-500">
                        {o.same
                          ? 'Your current slot'
                          : !o.free
                          ? 'Not free for the whole session'
                          : o.tooCostly
                          ? `Costs ${peso(o.cost - booking.courtCost)} more than you paid`
                          : o.court.id === booking.courtId
                          ? 'Your court'
                          : 'Open'}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-zinc-900">{peso(o.cost)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {!loading && selected && selected.okCount === 0 && (
        <InlineError>That time was just taken or is no longer available. Go back and pick another time.</InlineError>
      )}

      <div className="divide-y divide-zinc-100 rounded-3xl border border-zinc-200 bg-white text-sm">
        <div className="p-4">
          <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-zinc-400">From</span>
          <span className="block font-semibold text-zinc-600 line-through decoration-zinc-300">
            {booking.courtName} · {from.day}
          </span>
          <span className="text-zinc-500">{from.time}</span>
        </div>
        <div className="bg-emerald-50/50 p-4">
          <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-[#15803D]">To</span>
          <span className="block font-semibold text-zinc-950">
            {option?.ok ? `${option.court.name} · ` : ''}{toDay}
          </span>
          <span className="text-zinc-700">{toTime}</span>
        </div>
        <div className="flex items-center justify-between p-4 text-zinc-700">
          <span>Same length</span>
          <span className="font-semibold text-zinc-950">{hrsLabel(booking.hours)}</span>
        </div>
      </div>

      {option?.ok && (
        <p className="text-sm text-zinc-600">
          {cheaperBy > 0
            ? `This slot is cheaper (${peso(option.cost)} instead of ${peso(booking.courtCost)}). The difference isn't refunded.`
            : 'Same price as your booking. Nothing more to pay.'}
        </p>
      )}

      {state === 'weather' ? (
        <div className="flex gap-3 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950 ring-1 ring-sky-200">
          <CloudRain className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          <p>This move is free, and it doesn't use your one reschedule.</p>
        </div>
      ) : (
        <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-100">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>
            <strong>You can only reschedule once.</strong> After you confirm, this booking can't be moved again, so please double-check the date and time.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Done ──────────────────────────────────────────────────────────────────────
function MovedView({ booking }: { booking: Booking }) {
  const sched = fmtSchedule(booking.startAt, booking.endAt);
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 260 }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-[#15803D]"
      >
        <Check className="h-8 w-8" strokeWidth={3} />
      </motion.span>
      <div>
        <h3 className="text-2xl font-bold tracking-tight text-zinc-950">Moved! Your new pass is ready.</h3>
        <p className="mt-2 text-sm text-zinc-600">
          {booking.courtName} · {sched.day}
          {sched.note ? ` (${sched.note})` : ''}
        </p>
        <p className="text-sm font-semibold text-zinc-900">{sched.time}</p>
      </div>
    </div>
  );
}
