import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, Calendar, Check, ChevronLeft, ChevronRight, Clock, Lock, Moon, Pencil, ShieldCheck, Sparkles, Sun, Sunrise, Sunset, X } from 'lucide-react';
import { api, ApiError, errorMessage, serverNowMs } from '../../lib/api';
import { device } from '../../lib/device';
import { normalizePhone } from '../../lib/phone';
import { addDays, afterMidnightNote, currentPlayDate, daysBetween, fmtDate, hourLabel, hourTimeLabel, peso } from '../../lib/time';
import { useAvailability, useConfig } from '../../hooks/useBookingData';
import type { AppConfig, Availability, BookingDraftSeed, BookingWithToken, PaymentMethod, SlotAvailability, TimePeriod } from '../../types';
import { PrivacyNotice } from './PrivacyNotice';
import { cx, InlineError, PrimaryButton, useBodyScrollLock } from './ui';

type Step = 'date' | 'time' | 'court' | 'details' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'court', label: 'Court' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review' },
];

const PERIODS: { id: TimePeriod; label: string; range: string; Icon: typeof Sun }[] = [
  { id: 'morning', label: 'Morning', range: '6 AM – 12 PM', Icon: Sunrise },
  { id: 'afternoon', label: 'Afternoon', range: '12 – 5 PM', Icon: Sun },
  { id: 'evening', label: 'Evening', range: '5 – 10 PM', Icon: Sunset },
  { id: 'night_owl', label: 'Night Owl', range: '10 PM – 6 AM', Icon: Moon },
];

const isNightHour = (h: number) => h >= 22 || h < 6;

type SlotSummary = { state: 'available' | 'held' | 'booked' | 'past'; free: number };

function summarize(slot: SlotAvailability): SlotSummary {
  const states = Object.values(slot.courts);
  const free = states.filter((s) => s === 'available').length;
  if (free > 0) return { state: 'available', free };
  if (states.every((s) => s === 'past')) return { state: 'past', free: 0 };
  if (states.some((s) => s === 'held')) return { state: 'held', free: 0 };
  return { state: 'booked', free: 0 };
}

interface Props {
  seed: BookingDraftSeed;
  onClose: () => void;
  onHeld: (result: BookingWithToken) => void;
}

export const BookingSheet: React.FC<Props> = ({ seed, onClose, onHeld }) => {
  const { config, error: configError, reload } = useConfig();
  useBodyScrollLock();

  const saved = device.details();
  const [step, setStep] = useState<Step>(seed.hour != null && seed.date ? 'court' : seed.date ? 'time' : 'date');
  const [date, setDate] = useState<string | null>(seed.date ?? null);
  const [hour, setHour] = useState<number | null>(seed.hour ?? null);
  const [period, setPeriod] = useState<TimePeriod | null>(null);
  const [courtId, setCourtId] = useState<string | null>(seed.courtId ?? null);
  const [hours, setHours] = useState(1);
  const [paddles, setPaddles] = useState(false);
  const [name, setName] = useState(saved?.name ?? '');
  const [phone, setPhone] = useState(saved?.phone ?? '');
  const [remember, setRemember] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('gcash');
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = config?.today ?? currentPlayDate(serverNowMs());
  const activeDate = date ?? today;
  const needsAvailability = step === 'time' || step === 'court' || step === 'review';
  const { data: avail, error: availError, refresh } = useAvailability(activeDate, { enabled: needsAvailability });

  // Hours after 5 AM roll into the next play day, so a 5 AM + 2 hr booking needs tomorrow's grid too.
  const hourIndex = avail && hour != null ? avail.slots.findIndex((s) => s.hour === hour) : -1;
  const crossesDay = hourIndex >= 0 && hourIndex + (config?.maxHours ?? 3) > 24;
  const { data: nextAvail } = useAvailability(crossesDay ? addDays(activeDate, 1) : null, {
    enabled: needsAvailability && crossesDay,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !showPrivacy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showPrivacy]);

  // Default to an enabled payment method.
  useEffect(() => {
    const acct = config?.paymentAccounts.find((a) => a.method === method);
    if (acct && !acct.enabled) {
      const first = config?.paymentAccounts.find((a) => a.enabled);
      if (first) setMethod(first.method);
    }
  }, [config, method]);

  const slotAt = (offset: number): SlotAvailability | undefined => {
    if (!avail || hourIndex < 0) return undefined;
    const k = hourIndex + offset;
    return k < 24 ? avail.slots[k] : nextAvail?.slots[k - 24];
  };

  const courtFreeFor = (id: string, n: number) => {
    for (let i = 0; i < n; i++) {
      if (slotAt(i)?.courts[id] !== 'available') return false;
    }
    return true;
  };

  const court = config?.courts.find((c) => c.id === courtId) ?? null;
  const lineItems = useMemo(() => {
    if (!court || hour == null) return [];
    return Array.from({ length: hours }, (_, i) => {
      const h = (hour + i) % 24;
      return { hour: h, rate: isNightHour(h) ? court.nightRate : court.dayRate, night: isNightHour(h) };
    });
  }, [court, hour, hours]);
  const courtCost = lineItems.reduce((s, i) => s + i.rate, 0);
  const total = courtCost + (paddles ? config?.paddleFee ?? 0 : 0);

  const phoneNormalized = normalizePhone(phone);
  const nameValid = name.trim().replace(/\s+/g, ' ').length >= 2;
  const account = config?.paymentAccounts.find((a) => a.method === method);
  const selectionFree = court != null && hour != null && courtFreeFor(court.id, hours);

  // If the chosen court stops being free (someone else grabbed it), pick the other one if possible.
  useEffect(() => {
    if (step !== 'court' || hour == null || !avail || !config) return;
    if (courtId && courtFreeFor(courtId, hours)) return;
    const alt = config.courts.find((c) => courtFreeFor(c.id, hours));
    if (alt && alt.id !== courtId) setCourtId(alt.id);
  }, [step, hour, hours, avail, nextAvail, config]); // courtFreeFor is derived from these

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goBack = () => (stepIndex === 0 ? onClose() : setStep(STEPS[stepIndex - 1].id));

  const canContinue =
    (step === 'date' && !!activeDate) ||
    (step === 'time' && hour != null && hourIndex >= 0 && summarize(avail!.slots[hourIndex]).state === 'available') ||
    (step === 'court' && selectionFree) ||
    (step === 'details' && nameValid && !!phoneNormalized && !!account?.enabled) ||
    (step === 'review' && consent && selectionFree);

  const next = () => {
    setError(null);
    if (step === 'details' && (!nameValid || !phoneNormalized)) {
      setTouched(true);
      return;
    }
    if (step === 'review') return confirmHold();
    setStep(STEPS[stepIndex + 1].id);
  };

  const confirmHold = async () => {
    if (!config || !court || hour == null || !phoneNormalized) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createBooking({
        courtId: court.id,
        date: activeDate,
        hour,
        hours,
        paddles,
        customerName: name.trim(),
        customerPhone: phoneNormalized,
        paymentMethod: method,
        consent,
        consentVersion: config.consentVersion,
        marketingOptIn: marketing,
      });
      device.saveDetails(remember ? { name: name.trim(), phone: phoneNormalized } : null);
      onHeld(result);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(errorMessage(e));
      if (code === 'slot_taken' || code === 'slot_past') {
        refresh();
        setStep(code === 'slot_past' ? 'time' : 'court');
      } else if (code === 'consent_outdated') {
        setConsent(false);
        reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pickDate = (d: string) => {
    if (d !== date) {
      setDate(d);
      setHour(null);
      setPeriod(null);
    }
    setTimeout(() => setStep('time'), 120);
  };

  const pickHour = (h: number) => {
    setHour(h);
    setTimeout(() => setStep('court'), 120);
  };


  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 30, stiffness: 340 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#FBFCFB] sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[28px] sm:shadow-2xl"
      >
        {/* Header */}
        <header className="shrink-0 border-b border-zinc-100 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={goBack} className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 cursor-pointer" aria-label={stepIndex === 0 ? 'Close' : 'Back'}>
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <h2 id="booking-title" className="text-[15px] font-bold text-zinc-950">Book a court</h2>
              <p className="text-xs text-zinc-500">
                Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].label}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 cursor-pointer" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden>
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
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {configError && !config ? (
            <div className="space-y-3 py-10 text-center">
              <InlineError>{configError.message}</InlineError>
              <PrimaryButton size="md" onClick={reload}>Try again</PrimaryButton>
            </div>
          ) : (
            <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
              {step === 'date' && config && (
                <DateStep config={config} today={today} selected={activeDate} onPick={pickDate} />
              )}
              {step === 'time' && (
                <TimeStep
                  date={activeDate}
                  avail={avail}
                  error={availError?.message}
                  selectedHour={hour}
                  period={period}
                  onPeriod={setPeriod}
                  onPick={pickHour}
                  onRetry={refresh}
                />
              )}
              {step === 'court' && config && hour != null && (
                <CourtStep
                  config={config}
                  date={activeDate}
                  hour={hour}
                  hours={hours}
                  onHours={setHours}
                  courtId={courtId}
                  onCourt={setCourtId}
                  courtFreeFor={courtFreeFor}
                  slotAt={slotAt}
                  loading={!avail}
                  paddles={paddles}
                  onPaddles={setPaddles}
                  lineItems={lineItems}
                />
              )}
              {step === 'details' && config && (
                <DetailsStep
                  config={config}
                  name={name}
                  onName={setName}
                  phone={phone}
                  onPhone={setPhone}
                  remember={remember}
                  onRemember={setRemember}
                  method={method}
                  onMethod={setMethod}
                  showErrors={touched}
                  nameValid={nameValid}
                  phoneValid={!!phoneNormalized}
                />
              )}
              {step === 'review' && config && court && hour != null && (
                <ReviewStep
                  config={config}
                  date={activeDate}
                  hour={hour}
                  hours={hours}
                  courtName={court.name}
                  name={name.trim()}
                  phone={phoneNormalized ?? phone}
                  methodLabel={account?.label ?? method}
                  paddles={paddles}
                  lineItems={lineItems}
                  total={total}
                  consent={consent}
                  onConsent={setConsent}
                  marketing={marketing}
                  onMarketing={setMarketing}
                  onEdit={setStep}
                  onPrivacy={() => setShowPrivacy(true)}
                  stillFree={selectionFree}
                />
              )}
              {error && <div className="mt-4"><InlineError>{error}</InlineError></div>}
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-zinc-100 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="mb-3 rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/70 via-white to-emerald-50/50 p-2 sm:p-2.5 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {/* Date chip */}
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1 text-xs font-heading font-extrabold text-zinc-900 shadow-xs ring-1 ring-zinc-200/90">
                  <Calendar className="h-3.5 w-3.5 text-[#15803D] shrink-0" />
                  <span>{fmtDate(activeDate)}</span>
                </span>

                {/* Time chip */}
                {hour != null && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1 text-xs font-heading font-extrabold text-zinc-900 shadow-xs ring-1 ring-zinc-200/90">
                    <Clock className="h-3.5 w-3.5 text-[#15803D] shrink-0" />
                    <span>{hourLabel(hour)}</span>
                    {isNightHour(hour) && (
                      <Moon className="h-3 w-3 text-amber-500 fill-amber-500/20 shrink-0" />
                    )}
                  </span>
                )}

                {/* Court chip */}
                {court && step !== 'date' && step !== 'time' && (
                  <span className="inline-flex items-center rounded-xl bg-[#15803D] px-2.5 py-1 text-xs font-heading font-black uppercase tracking-wider text-white shadow-xs">
                    {court.name}
                  </span>
                )}

                {/* Duration chip */}
                {hour != null && step !== 'date' && step !== 'time' && (
                  <span className="inline-flex items-center rounded-xl bg-emerald-100/90 px-2 py-1 text-[11px] font-sport font-black uppercase tracking-wider text-[#15803D] border border-emerald-200/70">
                    {hours} hr{hours > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Total cost badge */}
              {court && hour != null && step !== 'date' && step !== 'time' && (
                <div className="flex items-baseline gap-1 shrink-0 pl-1">
                  <span className="text-[10px] font-sport font-extrabold uppercase tracking-widest text-zinc-400">Total</span>
                  <span className="font-heading font-black text-sm sm:text-base text-zinc-950 tracking-tight text-[#15803D]">
                    {peso(total)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <PrimaryButton className="w-full shadow-md shadow-emerald-950/10 text-sm font-heading font-extrabold uppercase tracking-wider" disabled={!canContinue} loading={submitting} onClick={next}>
            {step === 'review' ? `Confirm & hold for ${config?.holdMinutes ?? 15} min` : 'Continue'}
            {step !== 'review' && <ChevronRight className="h-4 w-4" />}
          </PrimaryButton>
        </footer>
      </motion.div>

      {showPrivacy && <PrivacyNotice onClose={() => setShowPrivacy(false)} />}
    </div>
  );
};

// ── Step 1: Date ──────────────────────────────────────────────────────────────
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function DateStep({ config, today, selected, onPick }: { config: AppConfig; today: string; selected: string; onPick: (d: string) => void }) {
  const last = addDays(today, config.bookingWindowDays);
  const [month, setMonth] = useState(selected.slice(0, 7)); // YYYY-MM
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const canPrev = month > today.slice(0, 7);
  const canNext = month < last.slice(0, 7);
  const quick = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
  ];

  return (
    <div className="space-y-5">
      <StepTitle title="When do you want to play?" subtitle={`Book up to ${config.bookingWindowDays} days ahead. Open 24/7.`} />
      <div className="grid grid-cols-2 gap-2">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onPick(q.date)}
            className={cx(
              'rounded-2xl border px-4 py-3 text-left transition cursor-pointer',
              selected === q.date ? 'border-[#15803D] bg-emerald-50 ring-2 ring-emerald-200' : 'border-zinc-200 bg-white hover:border-emerald-300'
            )}
          >
            <span className="block text-sm font-bold text-zinc-950">{q.label}</span>
            <span className="text-xs text-zinc-500">{fmtDate(q.date)}</span>
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-900">{fmtDate(`${month}-01`, { month: 'long', year: 'numeric' })}</span>
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
            const out = d < today || d > last;
            const isSel = d === selected;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                disabled={out}
                onClick={() => onPick(d)}
                aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                aria-pressed={isSel}
                className={cx(
                  'mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition cursor-pointer',
                  out && 'cursor-not-allowed text-zinc-300',
                  !out && !isSel && 'text-zinc-800 hover:bg-emerald-50',
                  isSel && 'bg-[#15803D] text-white shadow-sm',
                  isToday && !isSel && 'ring-1 ring-[#15803D] text-[#15803D]'
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Time ──────────────────────────────────────────────────────────────
function TimeStep({
  date, avail, error, selectedHour, period, onPeriod, onPick, onRetry,
}: {
  date: string;
  avail: Availability | null;
  error?: string;
  selectedHour: number | null;
  period: TimePeriod | null;
  onPeriod: (p: TimePeriod) => void;
  onPick: (h: number) => void;
  onRetry: () => void;
}) {
  const firstOpen = avail?.slots.find((s) => summarize(s).state === 'available')?.period;
  const selectedPeriod = avail?.slots.find((s) => s.hour === selectedHour)?.period;
  const active = period ?? selectedPeriod ?? firstOpen ?? 'morning';
  const slots = avail?.slots.filter((s) => s.period === active) ?? [];
  const openCount = (p: TimePeriod) => avail?.slots.filter((s) => s.period === p && summarize(s).state === 'available').length ?? 0;

  return (
    <div className="space-y-5">
      <StepTitle
        title="Pick a start time"
        subtitle={`${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} · updates live`}
      />
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-zinc-100 p-1.5">
        {PERIODS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPeriod(id)}
            className={cx(
              'flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-semibold transition cursor-pointer',
              active === id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <Icon className={cx('h-4 w-4', active === id ? 'text-[#15803D]' : '')} />
            <span>{label}</span>
            {avail && <span className="text-[10px] font-medium text-zinc-400">{openCount(id)} open</span>}
          </button>
        ))}
      </div>

      {error && !avail ? (
        <div className="space-y-3 text-center">
          <InlineError>{error}</InlineError>
          <PrimaryButton size="md" onClick={onRetry}>Try again</PrimaryButton>
        </div>
      ) : !avail ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-zinc-100" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => {
              const s = summarize(slot);
              const isSel = slot.hour === selectedHour;
              const isAvail = s.state === 'available';
              const isHeld = s.state === 'held';
              const isBooked = s.state === 'booked';
              const isPast = s.state === 'past';
              const disabled = !isAvail;

              return (
                <button
                  key={slot.hour}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(slot.hour)}
                  aria-pressed={isSel}
                  className={cx(
                    'relative rounded-2xl border px-2 py-3 text-center transition cursor-pointer',
                    isAvail && !isSel && 'border-zinc-200 bg-white text-zinc-900 hover:border-[#15803D] hover:shadow-xs',
                    isAvail && isSel && 'border-[#15803D] bg-[#15803D] text-white shadow-md shadow-emerald-900/20',
                    isHeld && 'cursor-not-allowed border-amber-300 bg-amber-50/80 text-amber-950',
                    isBooked && 'cursor-not-allowed border-rose-300 bg-rose-50/90 text-rose-950 shadow-2xs',
                    isPast && 'cursor-not-allowed border-transparent bg-zinc-100 text-zinc-400'
                  )}
                >
                  <span className={cx(
                    'block text-[15px] font-bold leading-tight',
                    isBooked && 'text-rose-950',
                    isHeld && 'text-amber-950',
                    isPast && 'text-zinc-400'
                  )}>
                    {hourLabel(slot.hour)}
                  </span>
                  <span className={cx(
                    'mt-0.5 block text-[11px] font-medium leading-tight',
                    isSel && 'text-emerald-100',
                    isAvail && !isSel && (s.free > 1 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'),
                    isHeld && 'text-amber-800 font-medium inline-flex items-center justify-center gap-0.5',
                    isBooked && 'text-rose-700 font-bold inline-flex items-center justify-center gap-0.5',
                    isPast && 'text-zinc-400'
                  )}>
                    {isAvail ? (
                      s.free > 1 ? `${s.free} courts open` : '1 court left'
                    ) : isHeld ? (
                      <>
                        <Clock className="h-2.5 w-2.5 inline" />
                        <span>On hold</span>
                      </>
                    ) : isBooked ? (
                      <>
                        <Lock className="h-2.5 w-2.5 inline" />
                        <span>Reserved</span>
                      </>
                    ) : (
                      'Passed'
                    )}
                  </span>

                  {slot.rateType === 'night_owl' && isAvail && (
                    <span className={cx('absolute right-1.5 top-1.5 rounded-full px-1.5 text-[9px] font-bold', isSel ? 'bg-[#CCFF00] text-zinc-900' : 'bg-emerald-100 text-emerald-800')}>
                      PROMO
                    </span>
                  )}
                  {isBooked && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-rose-200/90 px-1 py-0.5 text-[8px] font-black tracking-wider text-rose-800">
                      RED
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {active === 'night_owl' && (
            <p className="text-xs text-zinc-500">
              12 AM – 5 AM are the early hours of {fmtDate(addDays(date, 1))}. Night Owl rate applies 10 PM – 6 AM.
            </p>
          )}
          <Legend />
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-2xs">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Court Availability Legend</div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-md border-2 border-emerald-600 bg-white" />
          <span className="font-semibold text-zinc-800">Open (Available)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-md border border-amber-300 bg-amber-200" />
          <span className="font-medium text-amber-900">On Hold (15m)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-md border border-rose-300 bg-rose-200" />
          <span className="font-bold text-rose-900">Reserved (Red)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-md bg-zinc-200" />
          <span className="text-zinc-400">Passed</span>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Court & duration ──────────────────────────────────────────────────
function CourtStep({
  config, date, hour, hours, onHours, courtId, onCourt, courtFreeFor, slotAt, loading, paddles, onPaddles, lineItems,
}: {
  config: AppConfig;
  date: string;
  hour: number;
  hours: number;
  onHours: (n: number) => void;
  courtId: string | null;
  onCourt: (id: string) => void;
  courtFreeFor: (id: string, n: number) => boolean;
  slotAt: (offset: number) => SlotAvailability | undefined;
  loading: boolean;
  paddles: boolean;
  onPaddles: (v: boolean) => void;
  lineItems: { hour: number; rate: number; night: boolean }[];
}) {
  const endHour = (hour + hours) % 24;
  const note = afterMidnightNote(date, hour);

  // Maximum continuous hours available starting from this hour across all courts
  const maxContinuousOverall = Math.max(
    0,
    ...config.courts.map(
      (c) =>
        Array.from({ length: config.maxHours }, (_, i) => i + 1)
          .filter((n) => courtFreeFor(c.id, n))
          .pop() ?? 0
    )
  );

  // Is another court available for all requested hours?
  const altCourt =
    courtId && !courtFreeFor(courtId, hours)
      ? config.courts.find((c) => c.id !== courtId && courtFreeFor(c.id, hours))
      : null;

  // Selected court conflict details (if any)
  const currentCourt = config.courts.find((c) => c.id === courtId);
  const currentCourtFree = courtId ? courtFreeFor(courtId, hours) : false;
  const currentConflictOffset =
    courtId && !currentCourtFree
      ? Array.from({ length: hours }, (_, i) => i).find((i) => slotAt(i)?.courts[courtId] !== 'available')
      : null;
  const currentConflictHour = currentConflictOffset != null ? (hour + currentConflictOffset) % 24 : null;

  return (
    <div className="space-y-6">
      <StepTitle
        title="Court & duration"
        subtitle={`${note ?? fmtDate(date)} · ${hourTimeLabel(hour)} – ${hourTimeLabel(endHour)}`}
      />

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <Label>How long?</Label>
          {maxContinuousOverall < config.maxHours && maxContinuousOverall > 0 && (
            <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
              Max {maxContinuousOverall} hr{maxContinuousOverall > 1 ? 's' : ''} available
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: config.maxHours }, (_, i) => i + 1).map((n) => {
            const anyFree = config.courts.some((c) => courtFreeFor(c.id, n));
            const isBlocked = !loading && !anyFree;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onHours(n)}
                disabled={isBlocked}
                aria-pressed={hours === n}
                className={cx(
                  'rounded-2xl border py-3 text-center transition cursor-pointer disabled:cursor-not-allowed',
                  hours === n && !isBlocked
                    ? 'border-[#15803D] bg-emerald-50 ring-2 ring-emerald-200'
                    : isBlocked
                    ? 'border-rose-200 bg-rose-50/40 text-rose-900/60 opacity-60'
                    : 'border-zinc-200 bg-white hover:border-emerald-300'
                )}
              >
                <div className="flex items-center justify-center gap-1">
                  <span className={cx('block text-[15px] font-bold', isBlocked ? 'text-rose-950/70 line-through' : 'text-zinc-950')}>
                    {n} hr{n > 1 ? 's' : ''}
                  </span>
                  {isBlocked && <Lock className="h-3 w-3 text-rose-600" />}
                </div>
                <span className={cx('text-[11px]', isBlocked ? 'text-rose-700/80 font-medium' : 'text-zinc-500')}>
                  {isBlocked ? 'Blocked' : `until ${hourLabel((hour + n) % 24)}`}
                </span>
              </button>
            );
          })}
        </div>

        {/* Smart Alternatives & Conflict Explanations */}
        {altCourt && (
          <div className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50/95 p-3.5 text-xs text-emerald-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-2xs">
            <div className="flex items-start gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs mt-0.5">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="font-bold text-emerald-900">{altCourt.name} is open for all {hours} hours!</p>
                <p className="text-[11px] text-emerald-700">
                  {currentCourt?.name ?? 'Selected court'} is reserved at later hours, but {altCourt.name} can accommodate your full session.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCourt(altCourt.id)}
              className="self-start sm:self-center shrink-0 rounded-xl bg-emerald-700 px-3.5 py-1.5 font-bold text-white shadow-xs hover:bg-emerald-800 transition cursor-pointer"
            >
              Switch to {altCourt.name} →
            </button>
          </div>
        )}

        {!altCourt && !currentCourtFree && courtId && currentConflictHour != null && (
          <div className="mt-3 rounded-2xl border border-rose-300 bg-rose-50/95 p-3.5 text-xs text-rose-950 flex items-start gap-2.5 shadow-2xs">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-bold text-rose-950">Schedule Collision Notice</p>
              <p className="mt-0.5 text-rose-800">
                {hourLabel(currentConflictHour)} is already reserved on {currentCourt?.name}. Please select a shorter duration ({maxContinuousOverall} hr max) or choose another starting time.
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <Label>Court</Label>
        <div className="space-y-2">
          {config.courts.map((c) => {
            const free = courtFreeFor(c.id, hours);
            const isSel = courtId === c.id && free;

            // Conflict inspection for this specific court
            const conflictOffset = !free
              ? Array.from({ length: hours }, (_, i) => i).find((i) => slotAt(i)?.courts[c.id] !== 'available')
              : null;
            const conflictHour = conflictOffset != null ? (hour + conflictOffset) % 24 : null;
            const conflictState = conflictOffset != null ? slotAt(conflictOffset)?.courts[c.id] : null;

            // Max continuous hours on this specific court
            const maxOnThisCourt =
              Array.from({ length: config.maxHours }, (_, i) => i + 1)
                .filter((n) => courtFreeFor(c.id, n))
                .pop() ?? 0;

            return (
              <button
                key={c.id}
                type="button"
                disabled={!free}
                onClick={() => onCourt(c.id)}
                aria-pressed={isSel}
                className={cx(
                  'flex w-full items-center justify-between rounded-2xl border p-4 text-left transition cursor-pointer disabled:cursor-not-allowed',
                  isSel
                    ? 'border-[#15803D] bg-emerald-50 ring-2 ring-emerald-200'
                    : free
                    ? 'border-zinc-200 bg-white hover:border-emerald-300'
                    : 'border-rose-200 bg-rose-50/40 text-zinc-500'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cx(
                    'flex h-6 w-6 items-center justify-center rounded-full border-2',
                    isSel ? 'border-[#15803D] bg-[#15803D] text-white' : free ? 'border-zinc-300' : 'border-rose-300 bg-rose-100 text-rose-600'
                  )}>
                    {isSel && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    {!free && <Lock className="h-3 w-3" />}
                  </span>
                  <div>
                    <span className={cx('block text-[15px] font-bold', free ? 'text-zinc-950' : 'text-zinc-800')}>{c.name}</span>
                    <span className="text-xs text-zinc-500">
                      {free ? (
                        'Full-size · pro blue acrylic surface'
                      ) : maxOnThisCourt > 0 ? (
                        <span className="font-semibold text-rose-700">Open for {maxOnThisCourt} hr only before next booking</span>
                      ) : (
                        <span className="font-semibold text-rose-700">Unavailable for this time</span>
                      )}
                    </span>
                  </div>
                </div>
                <div>
                  {loading ? (
                    <span className="text-xs font-semibold text-zinc-400">Checking…</span>
                  ) : free ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                      ● Available for {hours} hr{hours > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 border border-rose-200">
                      <Lock className="h-3 w-3" />
                      {conflictState === 'held'
                        ? `On Hold at ${conflictHour != null ? hourLabel(conflictHour) : ''}`
                        : `Reserved at ${conflictHour != null ? hourLabel(conflictHour) : ''}`}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <img src="/images/gear-paddle.webp" alt="" className="h-11 w-11 rounded-xl object-cover" />
            <div>
              <span className="block text-sm font-bold text-zinc-950">Rent paddles</span>
              <span className="text-xs text-zinc-500">One pair · balls included · +{peso(config.paddleFee)}</span>
            </div>
          </div>
          <input type="checkbox" checked={paddles} onChange={(e) => onPaddles(e.target.checked)} className="h-5 w-5 accent-[#15803D]" />
        </label>
      </section>

      {lineItems.length > 0 && (
        <section className="rounded-2xl bg-zinc-50 p-4 text-sm">
          {lineItems.map((li, i) => (
            <div key={i} className="flex justify-between py-0.5 text-zinc-600">
              <span>
                {hourLabel(li.hour)} – {hourLabel((li.hour + 1) % 24)}
                {li.night && <span className="ml-1.5 text-xs font-semibold text-emerald-700">Night Owl</span>}
              </span>
              <span>{peso(li.rate)}</span>
            </div>
          ))}
          {paddles && (
            <div className="flex justify-between py-0.5 text-zinc-600">
              <span>Paddle rental</span>
              <span>{peso(config.paddleFee)}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Step 4: Details & payment method ──────────────────────────────────────────
function DetailsStep({
  config, name, onName, phone, onPhone, remember, onRemember, method, onMethod, showErrors, nameValid, phoneValid,
}: {
  config: AppConfig;
  name: string;
  onName: (v: string) => void;
  phone: string;
  onPhone: (v: string) => void;
  remember: boolean;
  onRemember: (v: boolean) => void;
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  showErrors: boolean;
  nameValid: boolean;
  phoneValid: boolean;
}) {
  const [blurred, setBlurred] = useState({ name: false, phone: false });
  const nameErr = (showErrors || blurred.name) && !nameValid;
  const phoneErr = (showErrors || blurred.phone) && !phoneValid;
  return (
    <div className="space-y-6">
      <StepTitle title="Your details" subtitle="Your name goes on the pass. We use your number only about this booking." />
      <div className="space-y-4">
        <Field label="Full name" error={nameErr ? 'Enter your full name.' : undefined}>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            onBlur={() => setBlurred((b) => ({ ...b, name: true }))}
            placeholder="Juan dela Cruz"
            maxLength={80}
            className={inputClass(nameErr)}
          />
        </Field>
        <Field label="Mobile number" error={phoneErr ? 'Enter a valid PH mobile number, e.g. 0912 345 6789.' : undefined}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            onBlur={() => setBlurred((b) => ({ ...b, phone: true }))}
            placeholder="0912 345 6789"
            maxLength={16}
            className={inputClass(phoneErr)}
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-600">
          <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} className="h-4 w-4 accent-[#15803D]" />
          Remember my details on this device
        </label>
      </div>

      <section>
        <Label>Pay with</Label>
        <div className="grid grid-cols-2 gap-2">
          {config.paymentAccounts.map((a) => {
            const isSel = method === a.method && a.enabled;
            return (
              <button
                key={a.method}
                type="button"
                disabled={!a.enabled}
                onClick={() => onMethod(a.method)}
                aria-pressed={isSel}
                className={cx(
                  'rounded-2xl border p-4 text-left transition cursor-pointer disabled:cursor-not-allowed',
                  isSel ? 'border-[#15803D] bg-emerald-50 ring-2 ring-emerald-200' : 'border-zinc-200 bg-white hover:border-emerald-300',
                  !a.enabled && 'opacity-50'
                )}
              >
                <span className={cx('mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black text-white', a.method === 'gcash' ? 'bg-[#007DFE]' : 'bg-[#00B0A0]')}>
                  {a.method === 'gcash' ? 'G' : 'GT'}
                </span>
                <span className="block text-[15px] font-bold text-zinc-950">{a.label}</span>
                <span className="text-xs text-zinc-500">{a.enabled ? 'Send money, upload receipt' : 'Coming soon'}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── Step 5: Review ────────────────────────────────────────────────────────────
function ReviewStep(props: {
  config: AppConfig;
  date: string;
  hour: number;
  hours: number;
  courtName: string;
  name: string;
  phone: string;
  methodLabel: string;
  paddles: boolean;
  lineItems: { hour: number; rate: number; night: boolean }[];
  total: number;
  consent: boolean;
  onConsent: (v: boolean) => void;
  marketing: boolean;
  onMarketing: (v: boolean) => void;
  onEdit: (s: Step) => void;
  onPrivacy: () => void;
  stillFree: boolean;
}) {
  const { config, date, hour, hours } = props;
  const endHour = (hour + hours) % 24;
  const note = afterMidnightNote(date, hour);
  const days = daysBetween(config.today, date);
  return (
    <div className="space-y-5">
      <StepTitle title="Review your booking" subtitle="Check everything. You can still edit any part." />
      <div className="divide-y divide-zinc-100 rounded-3xl border border-zinc-200 bg-white">
        <ReviewRow label="When" onEdit={() => props.onEdit('date')}>
          <span className="block font-semibold text-zinc-950">{note ?? fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <span className="text-zinc-600">
            {hourTimeLabel(hour)} – {hourTimeLabel(endHour)} · {hours} hr{hours > 1 ? 's' : ''}
            {days === 0 ? ' · Today' : days === 1 ? ' · Tomorrow' : ''}
          </span>
        </ReviewRow>
        <ReviewRow label="Court" onEdit={() => props.onEdit('court')}>
          <span className="block font-semibold text-zinc-950">{props.courtName}</span>
          <span className="text-zinc-600">{props.paddles ? 'With paddle rental' : 'No paddle rental'}</span>
        </ReviewRow>
        <ReviewRow label="Player" onEdit={() => props.onEdit('details')}>
          <span className="block font-semibold text-zinc-950">{props.name}</span>
          <span className="text-zinc-600">{props.phone}</span>
        </ReviewRow>
        <ReviewRow label="Payment" onEdit={() => props.onEdit('details')}>
          <span className="block font-semibold text-zinc-950">{props.methodLabel}</span>
          <span className="text-zinc-600">Send money, then upload your receipt</span>
        </ReviewRow>
        <div className="space-y-1 p-4 text-sm">
          {props.lineItems.map((li, i) => (
            <div key={i} className="flex justify-between text-zinc-600">
              <span>{hourLabel(li.hour)} – {hourLabel((li.hour + 1) % 24)}{li.night ? ' (Night Owl)' : ''}</span>
              <span>{peso(li.rate)}</span>
            </div>
          ))}
          {props.paddles && (
            <div className="flex justify-between text-zinc-600"><span>Paddle rental</span><span>{peso(config.paddleFee)}</span></div>
          )}
          <div className="flex justify-between pt-2 text-base font-bold text-zinc-950">
            <span>Total</span>
            <span>{peso(props.total)}</span>
          </div>
        </div>
      </div>

      {!props.stillFree && (
        <InlineError>This slot was just taken by someone else. Tap Edit on “When” or “Court” to pick another.</InlineError>
      )}

      <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-100">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p>
          When you confirm, this slot is <strong>held for you for {config.holdMinutes} minutes</strong>. Send the payment and upload your
          receipt within that time, or the slot is released for others.
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/60 p-4 text-xs text-emerald-950 space-y-1.5">
        <div className="flex items-center gap-1.5 font-heading font-black uppercase text-emerald-900 tracking-wider">
          <ShieldCheck className="h-4 w-4 text-[#15803D] shrink-0" />
          <span>House Rules Quick Notice</span>
        </div>
        <ul className="space-y-1 text-emerald-950/90 pl-4 list-disc font-medium text-[11px] sm:text-xs">
          <li><strong>20-Min No-Show Rule:</strong> Arrive on time. Slots with no check-in after 20 minutes are forfeited to walk-ins with no refund.</li>
          <li><strong>Footwear:</strong> Non-marking athletic court shoes strictly required (no flip-flops/bare feet).</li>
          <li><strong>CLAYGO:</strong> Water bottles only bench-side; dispose of trash in bins.</li>
        </ul>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          <input type="checkbox" checked={props.consent} onChange={(e) => props.onConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#15803D]" />
          <span>
            I agree to the House Rules, and that HousePickle Club stores my name, mobile number and payment proof to process this booking, as described in the{' '}
            <button type="button" onClick={(e) => { e.preventDefault(); props.onPrivacy(); }} className="font-semibold text-[#15803D] underline underline-offset-2 cursor-pointer">
              Privacy Notice
            </button>
            . <span className="text-zinc-400">(Required)</span>
          </span>
        </label>
        <label className="flex cursor-pointer gap-3 px-1 text-sm text-zinc-600">
          <input type="checkbox" checked={props.marketing} onChange={(e) => props.onMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#15803D]" />
          <span>Text me about promos and open-play events (optional)</span>
        </label>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <ShieldCheck className="h-3.5 w-3.5" /> Your details are only shared with the court host.
      </p>
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────
function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-xl font-bold tracking-tight text-zinc-950">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-sm font-semibold text-zinc-800">{children}</h4>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-zinc-800">{label}</span>
      {children}
      {error && <span className="mt-1.5 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}

const inputClass = (err: boolean) =>
  cx(
    'w-full rounded-2xl border bg-white px-4 py-3 text-base text-zinc-950 placeholder:text-zinc-400 transition',
    'focus:outline-none focus:ring-4',
    err ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-zinc-200 focus:border-[#15803D] focus:ring-emerald-100'
  );

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 p-4 text-sm">
      <div>
        <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
        {children}
      </div>
      <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-[#15803D] hover:bg-emerald-50 cursor-pointer">
        <Pencil className="h-3 w-3" /> Edit
      </button>
    </div>
  );
}
