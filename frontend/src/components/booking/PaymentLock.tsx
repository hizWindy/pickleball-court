import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Download, ImagePlus, Keyboard, Maximize2, QrCode, RefreshCw, Upload } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { prepareReceipt } from '../../lib/image';
import { fmtCountdown, fmtSchedule, fmtTime, pesoExact } from '../../lib/time';
import { useConfig, useCountdown } from '../../hooks/useBookingData';
import type { Booking } from '../../types';
import { CopyButton, cx, InlineError, PrimaryButton, SecondaryButton, useBodyScrollLock } from './ui';

interface Props {
  code: string;
  token: string;
  initial?: Booking;
  onSubmitted: (booking: Booking) => void;
  onClosed: (booking: Booking | null, reason: 'expired' | 'cancelled' | 'gone') => void;
}

/**
 * The 15-minute payment window. It covers the whole screen and the page behind it
 * is made `inert` by App, so taps can't leak through. The deadline comes from the
 * server; refreshing the page brings the player straight back here.
 */
export const PaymentLock: React.FC<Props> = ({ code, token, initial, onSubmitted, onClosed }) => {
  useBodyScrollLock();
  const { config } = useConfig();
  const [booking, setBooking] = useState<Booking | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'receipt' | 'reference'>('receipt');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const [paidTime, setPaidTime] = useState('');
  const [payerName, setPayerName] = useState(initial?.customerName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const left = useCountdown(booking?.holdExpiresAt ?? null);
  const totalMs = (config?.holdMinutes ?? 15) * 60_000;
  const timeUp = booking != null && left <= 0 && !busy;

  const sync = useCallback(async () => {
    try {
      const b = await api.getBooking(code, token);
      setBooking(b);
      setPayerName((p) => p || b.customerName);
      setLoadError(null);
      if (b.status === 'pending_verification' || b.status === 'confirmed') onSubmitted(b);
      else if (b.status === 'cancelled' || b.status === 'rejected') onClosed(b, 'cancelled');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) onClosed(null, 'gone');
      else setLoadError(errorMessage(e));
    }
  }, [code, token, onSubmitted, onClosed]);

  // Re-check with the server on open and whenever the player comes back from GCash/GoTyme.
  useEffect(() => {
    sync();
    const onVisible = () => document.visibilityState === 'visible' && sync();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const account = config?.paymentAccounts.find((a) => a.method === booking?.paymentMethod);

  const pickFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) {
      setError('Please choose an image (a screenshot of your receipt).');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleProofError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'hold_expired') {
      sync();
    }
    setError(errorMessage(e));
  };

  const submitReceipt = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await prepareReceipt(file);
      const b = await api.uploadReceipt(code, token, blob, setProgress);
      onSubmitted(b);
    } catch (e) {
      handleProofError(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const submitReference = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const b = await api.submitReference(code, token, { referenceNumber: ref, paidTime, payerName });
      onSubmitted(b);
    } catch (err) {
      handleProofError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const b = await api.cancel(code, token);
      onClosed(b, 'cancelled');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const sched = booking ? fmtSchedule(booking.startAt, booking.endAt) : null;
  const isGcash = booking?.paymentMethod === 'gcash';
  const refDigits = ref.replace(/\D/g, '').length;

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-zinc-950/60 backdrop-blur-sm sm:items-center sm:p-4" role="alertdialog" aria-modal="true" aria-labelledby="pay-title">
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#FBFCFB] sm:h-auto sm:max-h-[92dvh] sm:max-w-lg sm:rounded-[28px] sm:shadow-2xl"
      >
        {/* Timer header */}
        <header className="shrink-0 bg-gradient-to-br from-[#15803D] to-[#0B3D1C] px-5 pb-5 pt-[max(1rem,env(safe-area-inset-top))] text-white">
          <div className="flex items-center gap-4">
            <TimerRing left={left} total={totalMs} />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#CCFF00]">Slot on hold</p>
              <h2 id="pay-title" className="text-lg font-bold leading-tight">Complete your payment</h2>
              {booking && (
                <p className="mt-0.5 truncate text-sm text-emerald-100">
                  {booking.courtName} · {sched?.day} · {sched?.time}
                </p>
              )}
            </div>
          </div>
          {booking && !timeUp && (
            <p className="mt-3 text-xs text-emerald-100/90">
              Held for you until <strong className="text-white">{fmtTime(booking.holdExpiresAt)}</strong>. Leaving to open {isGcash ? 'GCash' : 'GoTyme'} is fine; this page will be here when you come back.
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {!booking ? (
            <div className="space-y-3 py-12 text-center">
              {loadError ? (
                <>
                  <InlineError>{loadError}</InlineError>
                  <SecondaryButton onClick={sync}><RefreshCw className="h-4 w-4" /> Retry</SecondaryButton>
                </>
              ) : (
                <p className="text-sm text-zinc-500">Loading your booking…</p>
              )}
            </div>
          ) : timeUp ? (
            <div className="space-y-4 py-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100">
                <AlertTriangle className="h-6 w-6 text-zinc-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-950">Time's up</h3>
                <p className="mt-1 text-sm text-zinc-600">
                  The {config?.holdMinutes ?? 15}-minute window ended, so the slot was released. If you already sent money, contact the host
                  with your receipt.
                </p>
              </div>
              <PrimaryButton className="w-full" onClick={() => onClosed(booking, 'expired')}>Book again</PrimaryButton>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Step 1: send money */}
              <section>
                <StepHeading n={1} title={`Send ${pesoExact(booking.total)} via ${account?.label ?? 'GCash'}`} />
                <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4">
                  {account?.qrImage && (
                    <div className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-50 p-4 text-center">
                      <div>
                        <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-zinc-950">
                          <QrCode className="h-4 w-4 shrink-0 text-[#15803D]" /> Pay by QR
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">Works with {account.label} and other InstaPay apps</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQrOpen(true)}
                        className="relative h-44 w-44 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200 cursor-pointer"
                        aria-label={`Enlarge ${account.label} QR code`}
                      >
                        <img src={account.qrImage} alt={`${account.label} QR code`} className="h-full w-full object-contain" />
                        <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/70 text-white">
                          <Maximize2 className="h-3 w-3" />
                        </span>
                      </button>
                      <a
                        href={account.qrImage}
                        download={`HousePickle-${account.label}-QR.jpg`}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-100"
                      >
                        <Download className="h-4 w-4" /> Save QR image
                      </a>
                    </div>
                  )}
                  <Row label="Account name" value={account?.accountName ?? '—'} />
                  {account?.accountNumber ? (
                    <Row label={isGcash ? 'GCash number' : 'GoTyme account'} value={account.accountNumber} mono copy={account.accountNumber} />
                  ) : account?.accountHint ? (
                    <Row label="Account number" value={account.accountHint} mono />
                  ) : null}
                  <Row label="Exact amount" value={pesoExact(booking.total)} strong copy={booking.total.toFixed(2)} />
                  <p className="rounded-2xl bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-600">
                    {account?.qrImage ? (
                      <>
                        <strong className="text-zinc-800">Easiest:</strong> tap <em>Save QR image</em>, open {account.label}, choose
                        Scan QR, and upload the saved image from your gallery. Enter <strong>{pesoExact(booking.total)}</strong> and check
                        the name matches.
                        {account.accountNumber && isGcash && ' Or use Send Money with the number above.'}
                      </>
                    ) : (
                      <>Open {account?.label ?? 'GCash'} and send to the account above. Check the name matches before you send.</>
                    )}{' '}
                    Then take a screenshot of the receipt.
                  </p>
                </div>
                {qrOpen && account?.qrImage && (
                  <div
                    className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/80 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${account.label} QR code`}
                    onClick={() => setQrOpen(false)}
                  >
                    <div className="max-h-full w-full max-w-xs overflow-y-auto rounded-3xl bg-white p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <img src={account.qrImage} alt={`${account.label} QR code`} className="w-full rounded-2xl" />
                      <p className="mt-2 px-2 text-center text-xs text-zinc-500">
                        On iPhone, press and hold the image and choose <strong>Save to Photos</strong>.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <a
                          href={account.qrImage}
                          download={`HousePickle-${account.label}-QR.jpg`}
                          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#15803D] text-sm font-semibold text-white hover:bg-[#166534]"
                        >
                          <Download className="h-4 w-4" /> Save
                        </a>
                        <SecondaryButton className="flex-1" onClick={() => setQrOpen(false)}>Close</SecondaryButton>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Step 2: proof */}
              <section>
                <StepHeading n={2} title={mode === 'receipt' ? 'Upload your receipt' : 'Enter your payment details'} />
                {mode === 'receipt' ? (
                  <div className="space-y-3">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => pickFile(e.target.files?.[0])}
                    />
                    {preview ? (
                      <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50/50 p-3">
                        <img src={preview} alt="Receipt preview" className="h-24 w-16 rounded-xl object-cover ring-1 ring-zinc-200" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-900">{file?.name ?? 'Receipt'}</p>
                          <p className="text-xs text-zinc-500">Check it shows the amount and reference number.</p>
                          <button type="button" onClick={() => fileInput.current?.click()} className="mt-1.5 text-xs font-semibold text-[#15803D] cursor-pointer">
                            Replace
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-emerald-300 bg-white px-4 py-7 text-center transition hover:bg-emerald-50/50 cursor-pointer"
                      >
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-[#15803D]">
                          <ImagePlus className="h-6 w-6" />
                        </span>
                        <span className="text-[15px] font-bold text-zinc-950">Choose receipt screenshot</span>
                        <span className="text-xs text-zinc-500">Your latest screenshot is usually first in the list</span>
                      </button>
                    )}
                    {progress != null && (
                      <div>
                        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className={`h-full rounded-full bg-[#15803D] transition-all ${progress >= 1 ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                            style={{ width: `${Math.round(progress * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-500" aria-live="polite">
                          {progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Reading your receipt…'}
                        </p>
                      </div>
                    )}
                    <InlineError>{error}</InlineError>
                    <PrimaryButton className="w-full" disabled={!file} loading={busy} onClick={submitReceipt}>
                      <Upload className="h-4 w-4" /> {busy ? (progress != null && progress >= 1 ? 'Checking receipt' : 'Uploading') : 'Submit receipt'}
                    </PrimaryButton>
                    <button
                      type="button"
                      onClick={() => { setMode('reference'); setError(null); }}
                      className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-zinc-600 hover:text-zinc-900 cursor-pointer"
                    >
                      <Keyboard className="h-4 w-4" /> Can't upload? Type your reference number
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submitReference} className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-4">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-zinc-800">Reference number</span>
                      <input
                        value={ref}
                        onChange={(e) => setRef(e.target.value)}
                        inputMode={isGcash ? 'numeric' : 'text'}
                        autoComplete="off"
                        placeholder={isGcash ? '13 digits, e.g. 1092 837 461928' : 'As shown on your receipt'}
                        maxLength={40}
                        required
                        className="w-full rounded-2xl border border-zinc-200 px-4 py-3 font-mono text-base tracking-wide focus:border-[#15803D] focus:outline-none focus:ring-4 focus:ring-emerald-100"
                      />
                      {isGcash && ref && (
                        <span className={cx('mt-1 block text-xs', refDigits === 13 ? 'text-emerald-700' : 'text-zinc-500')}>
                          {refDigits}/13 digits
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-zinc-800">Time of payment</span>
                      <input
                        type="time"
                        value={paidTime}
                        onChange={(e) => setPaidTime(e.target.value)}
                        required
                        className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-base focus:border-[#15803D] focus:outline-none focus:ring-4 focus:ring-emerald-100"
                      />
                      <span className="mt-1 block text-xs text-zinc-500">Exactly as shown on your receipt.</span>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-zinc-800">Name on the account you paid from</span>
                      <input
                        value={payerName}
                        onChange={(e) => setPayerName(e.target.value)}
                        autoComplete="name"
                        maxLength={80}
                        required
                        className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-base focus:border-[#15803D] focus:outline-none focus:ring-4 focus:ring-emerald-100"
                      />
                    </label>
                    <InlineError>{error}</InlineError>
                    <PrimaryButton type="submit" className="w-full" loading={busy} disabled={!ref || !paidTime || payerName.trim().length < 2}>
                      Submit payment details
                    </PrimaryButton>
                    <button
                      type="button"
                      onClick={() => { setMode('receipt'); setError(null); }}
                      className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-[#15803D] cursor-pointer"
                    >
                      <ImagePlus className="h-4 w-4" /> Upload a receipt instead (faster)
                    </button>
                  </form>
                )}
              </section>

              {/* Cancel */}
              <section className="border-t border-zinc-100 pt-4 text-center">
                {confirmCancel ? (
                  <div className="space-y-3 rounded-2xl bg-zinc-50 p-4">
                    <p className="text-sm text-zinc-700">Cancel this booking and release the slot?</p>
                    <div className="flex gap-2">
                      <SecondaryButton className="flex-1" onClick={() => setConfirmCancel(false)} disabled={busy}>Keep it</SecondaryButton>
                      <button
                        type="button"
                        onClick={cancel}
                        disabled={busy}
                        className="flex-1 rounded-2xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                      >
                        Yes, cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmCancel(true)} className="text-sm font-medium text-zinc-500 underline-offset-2 hover:text-red-600 hover:underline cursor-pointer">
                    Cancel booking
                  </button>
                )}
              </section>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

function TimerRing({ left, total }: { left: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  const color = left < 60_000 ? '#F87171' : left < 180_000 ? '#FBBF24' : '#CCFF00';
  return (
    <div className="relative h-16 w-16 shrink-0" role="timer" aria-label={`${fmtCountdown(left)} left to pay`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold tabular-nums">{fmtCountdown(left)}</span>
    </div>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-bold text-zinc-950">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#15803D] text-xs text-white">{n}</span>
      {title}
    </h3>
  );
}

function Row({ label, value, mono, strong, copy }: { label: string; value: string; mono?: boolean; strong?: boolean; copy?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="block text-xs text-zinc-500">{label}</span>
        <span className={cx('block truncate text-zinc-950', mono && 'font-mono tracking-wide', strong ? 'text-lg font-bold' : 'text-[15px] font-semibold')}>
          {value}
        </span>
      </div>
      {copy && <CopyButton value={copy} />}
    </div>
  );
}
