import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, CheckCircle2, Clock, CloudRain, Download, MapPin, MapPinCheck, Share2, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api, ApiError, errorMessage } from '../../lib/api';
import { device } from '../../lib/device';
import { canSharePass, downloadPass, passState, qrDataUrl, sharePass } from '../../lib/pass';
import { fmtSchedule, peso, pesoAuto } from '../../lib/time';
import { useConfig } from '../../hooks/useBookingData';
import { COURT_DETAILS } from '../../data/mockData';
import type { Booking } from '../../types';
import { smsHref } from './helpers';
import { HostActions } from './shared';
import { cx, InlineError, PrimaryButton, SecondaryButton, StatusBadge, useBodyScrollLock } from './ui';

interface Props {
  code: string;
  token: string;
  initial?: Booking;
  autoDownload?: boolean;
  onClose: () => void;
  onResumePayment: (booking: Booking) => void;
  onReschedule: (booking: Booking) => void;
}

const CLOSED = ['expired', 'cancelled', 'rejected'];
const POLL_MS = 20_000;

export const PassView: React.FC<Props> = ({ code, token, initial, autoDownload, onClose, onResumePayment, onReschedule }) => {
  useBodyScrollLock();
  const { config } = useConfig();
  const [booking, setBooking] = useState<Booking | null>(initial ?? null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const lastStatus = useRef(initial?.status);
  const alive = useRef(true);

  const lateMinutes = config?.lateAfterMinutes ?? 15;
  const rescheduleHours = config?.rescheduleMinHours ?? 48;

  useEffect(() => {
    qrDataUrl(code, 360).then(setQr);
  }, [code]);

  const load = useCallback(async () => {
    try {
      const b = await api.getBooking(code, token);
      if (!alive.current) return;
      if (lastStatus.current && lastStatus.current !== 'confirmed' && b.status === 'confirmed') {
        confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#15803D', '#D2EE5E', '#22C55E'] });
      }
      lastStatus.current = b.status;
      setBooking(b);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 404) device.forgetPass(code);
      setError(errorMessage(e));
    }
  }, [code, token]);

  // Live status: the pass keeps itself current (payment confirmed, checked in, gone Late, rain delay...) while it's open.
  useEffect(() => {
    alive.current = true;
    load();
    const refresh = () => {
      if (document.visibilityState === 'visible' && !CLOSED.includes(lastStatus.current ?? '')) load();
    };
    const id = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  // Save the pass to the device automatically, once per booking.
  useEffect(() => {
    if (!autoDownload || !booking || device.wasDownloaded(code)) return;
    device.markDownloaded(code);
    downloadPass(booking)
      .then(() => setSavedNote('Your pass was saved to this device.'))
      .catch(() => setSavedNote(null));
  }, [autoDownload, booking, code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!booking) return;
    setSaving(true);
    try {
      const shared = canSharePass() && (await sharePass(booking));
      if (!shared) {
        await downloadPass(booking);
        setSavedNote('Downloaded. Check your Downloads or Files app.');
      }
    } catch {
      setSavedNote('Could not save the image. Take a screenshot of this pass instead.');
    } finally {
      setSaving(false);
    }
  };

  const checkIn = async () => {
    setCheckingIn(true);
    setCheckInError(null);
    try {
      const b = await api.checkIn(code, token);
      lastStatus.current = b.status;
      setBooking(b);
    } catch (e) {
      setCheckInError(errorMessage(e));
      load(); // the booking may have changed (e.g. it just went Late)
    } finally {
      setCheckingIn(false);
    }
  };

  const sched = booking ? fmtSchedule(booking.startAt, booking.endAt) : null;
  const state = booking ? passState(booking) : null;
  const closed = !!booking && CLOSED.includes(booking.status);
  const confirmed = booking?.status === 'confirmed';
  const rain = !!booking?.weatherHold;
  const late = !!booking?.late;
  const muted = closed || late;
  const showSave = !!booking && !closed && !late && !rain;
  // the Late and payment cards above already carry Call/Text buttons
  const hostShownAbove = late || (booking?.status === 'pending_verification' && !!booking.pendingReason);
  const showGameDay = !!booking && !closed && !late && !rain && !booking.arrived;

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Court pass">
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#EEF6EF] sm:h-auto sm:max-h-[94dvh] sm:max-w-md sm:rounded-[28px] sm:shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-sm font-semibold text-zinc-600">Your court pass</span>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-600 hover:bg-white/70 cursor-pointer" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {!booking || !state || !sched ? (
            <div className="py-16 text-center text-sm text-zinc-500">{error ? <InlineError>{error}</InlineError> : 'Loading pass…'}</div>
          ) : (
            <div className="space-y-4">
              {/* What needs attention comes first */}
              {rain && (
                <div className="rounded-3xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 via-white to-sky-50/60 p-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-500 text-white">
                      <CloudRain className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-heading text-sm font-black uppercase tracking-tight text-sky-950">Courts closed for rain</p>
                      <p className="mt-1 text-sm leading-relaxed text-sky-950/90">
                        The courts are closed for rain, so your session was moved. Pick a new time. It's free and doesn't use your one reschedule.
                      </p>
                    </div>
                  </div>
                  <PrimaryButton className="mt-3 w-full" onClick={() => onReschedule(booking)}>
                    <CalendarClock className="h-5 w-5" /> Pick a new time
                  </PrimaryButton>
                </div>
              )}

              {late && (
                <div className="rounded-3xl border border-zinc-300 bg-zinc-100 p-4">
                  <p className="font-heading text-sm font-black uppercase tracking-tight text-zinc-800">Marked Late</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                    You were more than {lateMinutes} minutes past your start time, so the court was released to other players. Paid bookings aren't
                    refundable. Please contact the host.
                  </p>
                  <HostActions code={booking.code} className="mt-3" />
                </div>
              )}

              {confirmed && booking.canCheckIn && !booking.arrived && (
                <div className="rounded-3xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60 p-4 shadow-xs">
                  <p className="font-heading text-sm font-black uppercase tracking-tight text-emerald-950">Here already?</p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-950/80">
                    Tap this when you get to the court. It lets us know your group is here, so your booking stays yours.
                  </p>
                  <PrimaryButton className="mt-3 min-h-14 w-full text-base" loading={checkingIn} onClick={checkIn}>
                    <MapPinCheck className="h-5 w-5" /> I've arrived
                  </PrimaryButton>
                  {checkInError && <div className="mt-3"><InlineError>{checkInError}</InlineError></div>}
                </div>
              )}

              {confirmed && booking.arrived && !rain && !late && (
                <div className="flex items-center gap-3 rounded-3xl border border-emerald-300 bg-emerald-50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-heading text-sm font-black uppercase tracking-tight text-emerald-950">Checked in ✓</p>
                    <p className="text-sm text-emerald-900/80">Thanks! Have a great game.</p>
                  </div>
                </div>
              )}

              {booking.status === 'pending_verification' && <PendingNotice booking={booking} />}

              {/* Ticket */}
              <div className={cx('overflow-hidden rounded-[28px] bg-white shadow-xl shadow-emerald-950/10', muted && 'opacity-75')}>
                <div
                  className={cx(
                    'bg-gradient-to-br px-6 pb-6 pt-5 text-white',
                    muted ? 'from-zinc-500 to-zinc-700' : rain ? 'from-sky-600 to-sky-900' : 'from-[#15803D] to-[#0B3D1C]'
                  )}
                >
                  <p className={cx('text-[11px] font-bold uppercase tracking-[0.2em]', muted ? 'text-zinc-200' : 'text-[#D2EE5E]')}>Court Pass</p>
                  <p className="text-2xl font-bold tracking-tight">HousePickle Club</p>
                </div>
                <div className="space-y-5 px-6 py-5">
                  <div>
                    <StatusBadge state={state} />
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Reservation no.</p>
                    <p className="whitespace-nowrap font-mono text-[26px] font-bold leading-tight tracking-wide text-zinc-950">{booking.code}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                    <Item label="Player" value={booking.customerName} wide />
                    <Item label="Court" value={booking.courtName} />
                    <Item label="Duration" value={`${booking.hours} hr${booking.hours > 1 ? 's' : ''}`} />
                    <Item label="Date" value={sched.day} sub={sched.note} />
                    <Item label="Time" value={sched.time} />
                    <Item label="Total" value={peso(booking.total)} sub={booking.paddles ? 'Includes paddles' : undefined} />
                    <Item label="Paid with" value={booking.paymentMethod === 'gcash' ? 'GCash' : 'GoTyme'} />
                  </dl>
                </div>
                <div className="relative border-t-2 border-dashed border-zinc-200 px-6 py-5">
                  <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[#EEF6EF]" />
                  <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-[#EEF6EF]" />
                  <div className="flex items-center gap-4">
                    {qr ? <img src={qr} alt={`QR code for ${booking.code}`} className={cx('h-24 w-24 rounded-xl', muted && 'opacity-60')} /> : <div className="h-24 w-24 rounded-xl bg-zinc-100" />}
                    <div className="text-xs text-zinc-600">
                      <p className="text-sm font-semibold text-zinc-900">{state.hint}</p>
                      <p className="mt-1">Staff scan this code to see the live status.</p>
                    </div>
                  </div>
                </div>
              </div>

              {savedNote && <p className="text-center text-xs font-medium text-emerald-800">{savedNote}</p>}
              <InlineError>{error && booking ? error : null}</InlineError>

              <div className="space-y-2">
                {booking.status === 'held' ? (
                  <PrimaryButton className="w-full" onClick={() => onResumePayment(booking)}>Continue payment</PrimaryButton>
                ) : showSave ? (
                  <PrimaryButton className="w-full" loading={saving} onClick={save}>
                    {canSharePass() ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                    {canSharePass() ? 'Save to Photos' : 'Download pass'}
                  </PrimaryButton>
                ) : null}
                <SecondaryButton className="w-full" onClick={onClose}>Done</SecondaryButton>
              </div>

              {/* One reschedule is the only flexibility a paid booking has */}
              {booking.reschedule === 'open' && (
                <div className="rounded-2xl bg-white/80 p-4">
                  <SecondaryButton className="w-full" onClick={() => onReschedule(booking)}>
                    <CalendarClock className="h-4 w-4" /> Reschedule
                  </SecondaryButton>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    You can reschedule once, at least {rescheduleHours} hours before your start time.
                  </p>
                </div>
              )}
              {(booking.reschedule === 'used' || booking.reschedule === 'too_late') && (
                <p className="rounded-2xl bg-white/80 p-4 text-sm leading-relaxed text-zinc-600">
                  {booking.reschedule === 'used'
                    ? "You've already used your one reschedule."
                    : `Rescheduling closes ${rescheduleHours} hours before your start time.`}{' '}
                  Need a change?{' '}
                  <a
                    href={smsHref(`Hi! About booking ${booking.code}: I'd like to ask about changing my time.`)}
                    className="font-semibold text-[#15803D] underline underline-offset-2"
                  >
                    Text the host
                  </a>
                  .
                </p>
              )}

              {showGameDay && (
                <div className="rounded-2xl border-2 border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-amber-50/50 p-4 text-xs text-amber-950 shadow-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500 text-white shrink-0">
                      <Clock className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-heading font-black uppercase text-amber-950 tracking-wider text-[11px] sm:text-xs">
                      Game-Day Notice: {lateMinutes}-Minute Late Rule
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] sm:text-xs leading-relaxed text-amber-900/90 font-medium">
                    Be on the court within {lateMinutes} minutes of your start time. After that your booking is marked Late, the court is released to
                    other players, and it is non-refundable. Arriving late doesn't extend your time. Strictly non-marking court shoes only.
                  </p>
                </div>
              )}

              <div className="rounded-2xl bg-white/80 p-4 text-sm">
                <p className="flex items-start gap-2 text-zinc-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" /> In front of Aloha Suites, Purok Masinadyahon, Brgy. San Isidro, Koronadal City
                </p>
                {!hostShownAbove && <HostActions code={booking.code} className="mt-3" />}
              </div>

              {confirmed && !rain && (
                <p className="px-2 text-center text-xs text-zinc-500">Bookings are final: no cancellations or refunds.</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

/** Why a payment is waiting for the host, in plain words, and what (if anything) the guest should do. */
function PendingNotice({ booking }: { booking: Booking }) {
  const method = booking.paymentMethod === 'gcash' ? 'GCash' : 'GoTyme';
  const paid = booking.amountPaid;
  const remaining = paid != null ? Math.round((booking.total - paid) * 100) / 100 : null;

  if (booking.pendingReason === 'amount_short') {
    return (
      <div className="rounded-3xl border-2 border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-amber-50/50 p-4 shadow-xs">
        <p className="font-heading text-sm font-black uppercase tracking-tight text-amber-950">Your payment is a bit short</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-950/90">
          {paid != null && remaining != null && remaining > 0 ? (
            <>
              Your receipt shows <strong>{pesoAuto(paid)}</strong> but your booking total is <strong>{pesoAuto(booking.total)}</strong>. Send the
              remaining <strong>{pesoAuto(remaining)}</strong> to the same account and text the host your new receipt.
            </>
          ) : (
            <>
              Your receipt looks short of your booking total of <strong>{pesoAuto(booking.total)}</strong>. Send the rest to the same account and
              text the host your new receipt.
            </>
          )}{' '}
          Your slot stays reserved while the host checks.
        </p>
        <HostActions
          code={booking.code}
          className="mt-3"
          message={`Hi! About booking ${booking.code}: ${remaining != null && remaining > 0 ? `I sent the remaining ${pesoAuto(remaining)}` : 'I sent the rest of the payment'}. Here is my new receipt.`}
        />
      </div>
    );
  }

  if (booking.pendingReason === 'amount_unreadable') {
    return (
      <div className="rounded-3xl border-2 border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-amber-50/50 p-4 shadow-xs">
        <p className="font-heading text-sm font-black uppercase tracking-tight text-amber-950">We're checking your receipt</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-950/90">
          We couldn't read the amount on your receipt. The host will check it. Your slot stays reserved.
        </p>
        <HostActions code={booking.code} className="mt-3" message={`Hi! About booking ${booking.code}: here is my receipt.`} />
      </div>
    );
  }

  return (
    <p className="rounded-2xl bg-white/80 p-4 text-sm text-zinc-700">
      <strong>What happens next:</strong> {COURT_DETAILS.contactPerson} checks the payment in {method}. Your slot stays reserved meanwhile, and this
      pass updates to <strong>Confirmed</strong> by itself. Late at night this may happen in the morning or when you arrive.
    </p>
  );
}

function Item({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="font-semibold text-zinc-950">{value}</dd>
      {sub && <dd className="text-xs text-zinc-500">{sub}</dd>}
    </div>
  );
}
