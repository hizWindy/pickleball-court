import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Download, MapPin, MessageSquare, Phone, Share2, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api, ApiError, errorMessage } from '../../lib/api';
import { device } from '../../lib/device';
import { canSharePass, downloadPass, qrDataUrl, sharePass, STATUS_COPY } from '../../lib/pass';
import { fmtSchedule, peso } from '../../lib/time';
import { COURT_DETAILS } from '../../data/mockData';
import type { Booking } from '../../types';
import { cx, InlineError, PrimaryButton, SecondaryButton, StatusBadge, useBodyScrollLock } from './ui';

interface Props {
  code: string;
  token: string;
  initial?: Booking;
  autoDownload?: boolean;
  onClose: () => void;
  onResumePayment: (booking: Booking) => void;
}

export const PassView: React.FC<Props> = ({ code, token, initial, autoDownload, onClose, onResumePayment }) => {
  useBodyScrollLock();
  const [booking, setBooking] = useState<Booking | null>(initial ?? null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lastStatus = useRef(initial?.status);

  useEffect(() => {
    qrDataUrl(code, 360).then(setQr);
  }, [code]);

  // Live status: payment proof confirms the booking right away; the host can still reject a bad one later.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await api.getBooking(code, token);
        if (!alive) return;
        if (lastStatus.current && lastStatus.current !== 'confirmed' && b.status === 'confirmed') {
          confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#15803D', '#CCFF00', '#22C55E'] });
        }
        lastStatus.current = b.status;
        setBooking(b);
        setError(null);
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) device.forgetPass(code);
        setError(errorMessage(e));
      }
    };
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && ['held', 'pending_verification'].includes(lastStatus.current ?? '')) load();
    }, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [code, token]);

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

  const cancel = async () => {
    setCancelling(true);
    try {
      const b = await api.cancel(code, token);
      setBooking(b);
      lastStatus.current = b.status;
      setConfirmCancel(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  const sched = booking ? fmtSchedule(booking.startAt, booking.endAt) : null;
  const status = booking ? STATUS_COPY[booking.status] : null;
  const closed = booking && ['expired', 'cancelled', 'rejected'].includes(booking.status);
  const canCancel = booking && ['held', 'pending_verification'].includes(booking.status);

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Court pass">
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#EEF6EF] sm:h-auto sm:max-h-[94dvh] sm:max-w-md sm:rounded-[28px] sm:shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-sm font-semibold text-zinc-600">Your court pass</span>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-zinc-600 hover:bg-white/70 cursor-pointer" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {!booking ? (
            <div className="py-16 text-center text-sm text-zinc-500">{error ? <InlineError>{error}</InlineError> : 'Loading pass…'}</div>
          ) : (
            <div className="space-y-4">
              {/* Ticket */}
              <div className={cx('overflow-hidden rounded-[28px] bg-white shadow-xl shadow-emerald-950/10', closed && 'opacity-75')}>
                <div className="bg-gradient-to-br from-[#15803D] to-[#0B3D1C] px-6 pb-6 pt-5 text-white">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#CCFF00]">Court Pass</p>
                  <p className="text-2xl font-bold tracking-tight">HousePickle Club</p>
                </div>
                <div className="space-y-5 px-6 py-5">
                  <div>
                    <StatusBadge status={booking.status} />
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Reservation no.</p>
                    <p className="whitespace-nowrap font-mono text-[26px] font-bold leading-tight tracking-wide text-zinc-950">{booking.code}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                    <Item label="Player" value={booking.customerName} wide />
                    <Item label="Court" value={booking.courtName} />
                    <Item label="Duration" value={`${booking.hours} hr${booking.hours > 1 ? 's' : ''}`} />
                    <Item label="Date" value={sched!.day} sub={sched!.note} />
                    <Item label="Time" value={sched!.time} />
                    <Item label="Total" value={peso(booking.total)} sub={booking.paddles ? 'Includes paddles' : undefined} />
                    <Item label="Paid with" value={booking.paymentMethod === 'gcash' ? 'GCash' : 'GoTyme'} />
                  </dl>
                </div>
                <div className="relative border-t-2 border-dashed border-zinc-200 px-6 py-5">
                  <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[#EEF6EF]" />
                  <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-[#EEF6EF]" />
                  <div className="flex items-center gap-4">
                    {qr ? <img src={qr} alt={`QR code for ${booking.code}`} className="h-24 w-24 rounded-xl" /> : <div className="h-24 w-24 rounded-xl bg-zinc-100" />}
                    <div className="text-xs text-zinc-600">
                      <p className="text-sm font-semibold text-zinc-900">{status?.hint}</p>
                      <p className="mt-1">Staff scan this code to see the live status.</p>
                    </div>
                  </div>
                </div>
              </div>

              {booking.status === 'pending_verification' && (
                <p className="rounded-2xl bg-white/80 p-4 text-sm text-zinc-700">
                  <strong>What happens next:</strong> {COURT_DETAILS.contactPerson} checks the payment in {booking.paymentMethod === 'gcash' ? 'GCash' : 'GoTyme'}.
                  Your slot stays reserved meanwhile, and this pass updates to <strong>Confirmed</strong> by itself. Late at night this
                  may happen in the morning or when you arrive.
                </p>
              )}

              {savedNote && <p className="text-center text-xs font-medium text-emerald-800">{savedNote}</p>}
              <InlineError>{error && booking ? error : null}</InlineError>

              <div className="space-y-2">
                {booking.status === 'held' ? (
                  <PrimaryButton className="w-full" onClick={() => onResumePayment(booking)}>Continue payment</PrimaryButton>
                ) : !closed ? (
                  <PrimaryButton className="w-full" loading={saving} onClick={save}>
                    {canSharePass() ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                    {canSharePass() ? 'Save to Photos' : 'Download pass'}
                  </PrimaryButton>
                ) : null}
                <SecondaryButton className="w-full" onClick={onClose}>Done</SecondaryButton>
              </div>

              <div className="rounded-2xl bg-white/80 p-4 text-sm">
                <p className="flex items-start gap-2 text-zinc-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" /> In front of Aloha Suites, Purok Masinadyahon, Brgy. San Isidro, Koronadal City
                </p>
                <div className="mt-3 flex gap-2">
                  <a href={`tel:${COURT_DETAILS.contactNumber}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200">
                    <Phone className="h-4 w-4" /> Call host
                  </a>
                  <a href={`sms:${COURT_DETAILS.contactNumber}?body=${encodeURIComponent(`Hi! About booking ${booking.code}: `)}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200">
                    <MessageSquare className="h-4 w-4" /> Text host
                  </a>
                </div>
              </div>

              {canCancel && (
                <div className="text-center">
                  {confirmCancel ? (
                    <div className="space-y-3 rounded-2xl bg-white p-4 text-left">
                      <p className="text-sm text-zinc-700">
                        Cancel and release this slot?
                        {booking.status === 'pending_verification' && ' If you already paid, contact the host for your refund.'}
                      </p>
                      <div className="flex gap-2">
                        <SecondaryButton className="flex-1" onClick={() => setConfirmCancel(false)}>Keep it</SecondaryButton>
                        <button type="button" disabled={cancelling} onClick={cancel} className="flex-1 rounded-2xl bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                          Yes, cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(true)} className="text-sm font-medium text-zinc-500 hover:text-red-600 cursor-pointer">
                      Cancel booking
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

function Item({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="font-semibold text-zinc-950">{value}</dd>
      {sub && <dd className="text-xs text-zinc-500">{sub}</dd>}
    </div>
  );
}
