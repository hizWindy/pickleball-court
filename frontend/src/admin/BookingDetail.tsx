import React, { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, CheckCircle2, ImageOff, Maximize2, Pencil, Phone, RotateCcw, ScanText, Trash2, X } from 'lucide-react';
import { CopyButton } from '../components/booking/ui';
import { errorMessage } from '../lib/api';
import { fmtDate, peso } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { clock, METHOD_LABEL, PROVIDER_LABEL, stamp, hourSpan } from './format';
import { useRemote } from './hooks';
import { Btn, Card, cx, Dialog, ErrorNote, Label, Sheet, StatusPill, Tag, TextArea } from './ui';
import type { AdminBookingDetail } from './types';

const REJECT_REASONS = ["Amount doesn't match", 'Reference not found', 'Paid to a different account', 'Receipt is unreadable', 'Payment is from a different time'];

type Ask = 'reject' | 'cancel' | 'delete' | 'confirm-unpaid' | null;

const EVENT_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  checked: 'You looked at the payment',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  edited: 'Edited',
  walk_in_added: 'Added by you',
  blocked: 'Court blocked',
};

const Row: React.FC<{ label: string; children: React.ReactNode; action?: React.ReactNode; emphasis?: boolean }> = ({ label, children, action, emphasis }) => (
  <div className="flex items-center justify-between gap-3 py-2.5">
    <dt className="shrink-0 text-sm text-zinc-500">{label}</dt>
    <dd className="flex min-w-0 items-center gap-2">
      <span className={cx('truncate text-right text-sm', emphasis ? 'font-heading font-bold text-zinc-950' : 'font-semibold text-zinc-900')}>{children}</span>
      {action}
    </dd>
  </div>
);

const Block: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <Card className={cx('px-4 pb-1 pt-3.5', className)}>
    <Label>{title}</Label>
    <dl className="mt-1 divide-y divide-zinc-100">{children}</dl>
  </Card>
);

export const BookingDetail: React.FC<{ code: string; onClose: () => void }> = ({ code, onClose }) => {
  const desk = useDesk();
  const { data: b, error, setData } = useRemote(`detail-${code}`, () => adminApi.get(code), { version: desk.refreshKey, intervalMs: 20000 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [reason, setReason] = useState('');
  const [zoom, setZoom] = useState(false);

  const run = async (action: () => Promise<AdminBookingDetail | void>, done: string, closeAfter = false) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await action();
      if (result) setData(result);
      desk.refresh();
      desk.notify(done);
      setAsk(null);
      setReason('');
      if (closeAfter) onClose();
    } catch (e) {
      setAsk(null);
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-semibold tracking-wider text-zinc-500">{code}</div>
        <h2 className="truncate font-heading text-xl font-bold tracking-tight text-zinc-950">{b ? (b.source === 'blocked' ? `Blocked: ${b.customerName}` : b.customerName) : 'Booking'}</h2>
      </div>
      {b && (
        <Btn size="sm" variant="ghost" onClick={() => desk.editBooking(code)} aria-label="Edit booking">
          <Pencil className="h-4 w-4" /> Edit
        </Btn>
      )}
    </div>
  );

  let footer: React.ReactNode = null;
  if (b) {
    const confirmed = b.status === 'confirmed';
    if (confirmed && b.needsReview) {
      footer = (
        <div className="flex gap-2">
          <Btn variant="danger" size="lg" onClick={() => setAsk('reject')} disabled={busy}>
            Reject
          </Btn>
          <Btn variant="primary" size="lg" className="flex-1" loading={busy} onClick={() => run(() => adminApi.check(code), 'Marked as looked at.')}>
            <Check className="h-5 w-5" /> Looks good
          </Btn>
        </div>
      );
    } else if (b.status === 'pending_verification') {
      footer = (
        <div className="flex gap-2">
          <Btn variant="danger" size="lg" onClick={() => setAsk('reject')} disabled={busy}>
            Reject
          </Btn>
          <Btn variant="primary" size="lg" className="flex-1" loading={busy} onClick={() => run(() => adminApi.confirm(code), 'Payment confirmed. The booking is locked in.')}>
            <Check className="h-5 w-5" /> Confirm payment
          </Btn>
        </div>
      );
    } else if (b.status === 'held') {
      footer = (
        <div className="flex gap-2">
          <Btn variant="danger" size="lg" onClick={() => setAsk('cancel')} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="dark" size="lg" className="flex-1" onClick={() => setAsk('confirm-unpaid')} disabled={busy}>
            Confirm without proof
          </Btn>
        </div>
      );
    } else if (confirmed) {
      footer = (
        <Btn variant="danger" size="lg" className="w-full" onClick={() => setAsk('cancel')} disabled={busy}>
          <Ban className="h-4 w-4" /> Cancel this booking
        </Btn>
      );
    } else if (b.source !== 'blocked') {
      footer = (
        <Btn variant="primary" size="lg" className="w-full" loading={busy} onClick={() => run(() => adminApi.confirm(code), 'Booking restored and confirmed.')}>
          <RotateCcw className="h-4 w-4" /> Restore and confirm
        </Btn>
      );
    } else {
      footer = (
        <Btn variant="danger" size="lg" className="w-full" onClick={() => setAsk('cancel')} disabled={busy}>
          Lift the block
        </Btn>
      );
    }
  }

  return (
    <>
      <Sheet label={`Booking ${code}`} title={title} onClose={onClose} footer={footer}>
        <div className="space-y-3 p-4 sm:p-5">
          {error && !b && <ErrorNote>{error.message}</ErrorNote>}
          {!b && !error && <div className="h-64 animate-pulse rounded-2xl bg-zinc-100" />}
          <ErrorNote>{problem}</ErrorNote>

          {b && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {b.source === 'blocked' ? <Tag tone="dark">Court blocked</Tag> : <StatusPill status={b.status} />}
                {b.source === 'walk_in' && <Tag>Walk-in</Tag>}
                {b.customPrice && b.source !== 'blocked' && <Tag tone="blue">Custom price</Tag>}
              </div>

              {b.source === 'online' && b.submittedAt && <PaymentProof b={b} onZoom={() => setZoom(true)} />}
              {b.status === 'held' && (
                <Card className="border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                  The player is still paying. If nothing arrives by <strong>{stamp(b.holdExpiresAt)}</strong>, the slot is released on its own.
                </Card>
              )}
              {b.status === 'rejected' && (
                <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  You rejected this payment. The hours are free for other players and the player's pass shows it wasn't verified.
                  Restore it below if you change your mind.
                </Card>
              )}

              <Block title="Schedule">
                <Row label="Date" emphasis>{fmtDate(b.playDate, { weekday: 'long', month: 'long', day: 'numeric' })}</Row>
                <Row label="Time" emphasis>
                  {hourSpan(b.hour, b.hours)} <span className="font-medium text-zinc-500">· {b.hours} h</span>
                </Row>
                <Row label="Court">{b.courtName}</Row>
                {b.hour < 6 && <Row label="Note"><span className="font-medium text-zinc-600">Early morning of the next day</span></Row>}
              </Block>

              {b.source !== 'blocked' && (
                <Block title="Player">
                  <Row label="Name">{b.customerName}</Row>
                  <Row
                    label="Mobile"
                    action={
                      b.customerPhone ? (
                        <>
                          <a href={`tel:${b.customerPhone}`} aria-label={`Call ${b.customerName}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-[#15803D] hover:bg-emerald-100">
                            <Phone className="h-4 w-4" />
                          </a>
                          <CopyButton value={b.customerPhone} />
                        </>
                      ) : null
                    }
                  >
                    {b.customerPhone ? b.customerPhone.replace(/(\d{4})(\d{3})(\d{4})/, '$1 $2 $3') : <span className="font-medium text-zinc-400">Not given</span>}
                  </Row>
                </Block>
              )}

              {b.source !== 'blocked' && (
                <Block title="Payment">
                  {b.lineItems.map((li) => {
                    const hour = new Date(li.startAt);
                    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(hour));
                    return (
                      <Row key={li.startAt} label={`${clock(h)}${li.rateType === 'night_owl' ? ' · Night Owl' : ''}`}>
                        {peso(li.rate)}
                      </Row>
                    );
                  })}
                  {b.paddles && <Row label="Paddle rental">{peso(b.addonsCost)}</Row>}
                  {b.customPrice && <Row label="Your adjustment"><span className="text-sky-700">{b.total - b.courtCost - b.addonsCost > 0 ? '+' : '−'}{peso(Math.abs(b.total - b.courtCost - b.addonsCost))}</span></Row>}
                  <Row label="Total" emphasis>{peso(b.total)}</Row>
                  <Row label="Paid with">{METHOD_LABEL[b.paymentMethod]}</Row>
                </Block>
              )}

              {b.adminNote && (
                <Card className="p-4">
                  <Label>Your note</Label>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-800">{b.adminNote}</p>
                </Card>
              )}

              <Timeline b={b} />

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setAsk('delete')}
                  className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-red-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-md"
                >
                  <Trash2 className="h-4 w-4" /> Delete this record
                </button>
              </div>
            </>
          )}
        </div>
      </Sheet>

      {zoom && b && <Lightbox code={code} onClose={() => setZoom(false)} />}

      {ask === 'reject' && (
        <Dialog
          title="Reject this payment?"
          onClose={() => setAsk(null)}
          actions={
            <>
              <Btn onClick={() => setAsk(null)}>Keep reviewing</Btn>
              <Btn variant="dark" loading={busy} onClick={() => run(() => adminApi.reject(code, reason.trim()), 'Payment rejected. The hours are free again.')}>
                Reject payment
              </Btn>
            </>
          }
        >
          <p>The hours go back on sale right away. The player will see that the payment wasn't verified.</p>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 cursor-pointer', reason === r ? 'bg-zinc-950 text-white ring-zinc-950' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50')}
              >
                {r}
              </button>
            ))}
          </div>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (only you see this)" maxLength={200} aria-label="Reason" />
        </Dialog>
      )}

      {ask === 'cancel' && b && (
        <Dialog
          title={b.source === 'blocked' ? 'Lift this block?' : 'Cancel this booking?'}
          onClose={() => setAsk(null)}
          actions={
            <>
              <Btn onClick={() => setAsk(null)}>Keep it</Btn>
              <Btn variant="dark" loading={busy} onClick={() => run(() => adminApi.cancel(code, reason.trim()), b.source === 'blocked' ? 'Block lifted.' : 'Booking cancelled. The hours are free again.')}>
                {b.source === 'blocked' ? 'Lift block' : 'Cancel booking'}
              </Btn>
            </>
          }
        >
          <p>{b.source === 'blocked' ? 'The court opens up for booking again.' : 'The hours go back on sale. Any refund is between you and the player.'}</p>
          {b.source !== 'blocked' && <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, only you see this)" maxLength={200} aria-label="Reason" />}
        </Dialog>
      )}

      {ask === 'confirm-unpaid' && (
        <Dialog
          title="Confirm without a payment proof?"
          onClose={() => setAsk(null)}
          actions={
            <>
              <Btn onClick={() => setAsk(null)}>Not yet</Btn>
              <Btn variant="primary" loading={busy} onClick={() => run(() => adminApi.confirm(code), 'Booking confirmed.')}>
                Yes, confirm
              </Btn>
            </>
          }
        >
          <p>Use this when the player paid you directly, for example in cash. The booking is locked in and the countdown stops.</p>
        </Dialog>
      )}

      {ask === 'delete' && (
        <Dialog
          title="Delete this record for good?"
          onClose={() => setAsk(null)}
          actions={
            <>
              <Btn onClick={() => setAsk(null)}>Keep it</Btn>
              <Btn variant="danger" loading={busy} className="!bg-red-600 !text-white hover:!bg-red-700 !ring-0" onClick={() => run(() => adminApi.remove(code), 'Booking deleted.', true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Btn>
            </>
          }
        >
          <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This erases the booking, its receipt image and its place in your revenue. It can't be undone. If you only want the hours back, cancel the booking instead.
            </span>
          </p>
        </Dialog>
      )}
    </>
  );
};

const Mark: React.FC<{ ok: boolean }> = ({ ok }) =>
  ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="matches" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="doesn't match" />;

const ReadRow: React.FC<{ label: string; ok?: boolean; children: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }> = ({ label, ok, children, hint, action }) => (
  <div className="flex items-start justify-between gap-3 py-2.5">
    <dt className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-500">
      {ok !== undefined && <Mark ok={ok} />}
      {label}
    </dt>
    <dd className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 text-right">
        <span className="block break-words text-sm font-semibold text-zinc-900">{children}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      {action}
    </dd>
  </div>
);

/**
 * The payment behind an online booking: what the server read off the receipt, compared with the
 * booking, and anything that didn't match. The booking is already confirmed; this is the host's
 * chance to catch a fake or a mistake.
 */
const PaymentProof: React.FC<{ b: AdminBookingDetail; onZoom: () => void }> = ({ b, onZoom }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const scan = b.scan && b.scan.engine !== 'none' ? b.scan : null;
  const codes = new Set(b.reviewFlags.map((f) => f.code));
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  const from = fmt.format(new Date(b.createdAt));
  const to = b.submittedAt ? fmt.format(new Date(b.submittedAt)) : null;
  const flagged = b.reviewFlags.length > 0;

  const tone = !b.needsReview ? 'zinc' : flagged ? 'amber' : 'green';
  const head = {
    zinc: { box: 'border-zinc-200', bar: 'bg-zinc-50', label: 'Payment proof', text: b.checkedAt ? `You looked at this on ${stamp(b.checkedAt)}.` : 'Checked.' },
    amber: {
      box: 'border-amber-300',
      bar: 'bg-amber-50',
      label: flagged && b.reviewFlags.length === 1 ? '1 thing to check' : `${b.reviewFlags.length} things to check`,
      text: 'The booking was confirmed automatically. Open your app and make sure this payment really arrived.',
    },
    green: { box: 'border-emerald-200', bar: 'bg-emerald-50', label: 'Receipt matches the booking', text: 'Confirmed automatically. A quick look in your app, then tap Looks good.' },
  }[tone];

  return (
    <Card className={cx('overflow-hidden', head.box)}>
      <div className={cx('px-4 py-3', head.bar)}>
        <Label className={tone === 'amber' ? '!text-amber-800' : tone === 'green' ? '!text-emerald-800' : undefined}>{head.label}</Label>
        <p className="mt-1 text-sm text-zinc-800">{head.text}</p>
        {flagged && (
          <ul className="mt-2.5 space-y-1.5">
            {b.reviewFlags.map((f) => (
              <li key={f.code} className="flex items-start gap-2 text-sm font-medium text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {b.proofType === 'receipt' && (
        <div className="border-b border-zinc-100 p-3">
          {b.hasReceipt && !imageFailed ? (
            <button type="button" onClick={onZoom} className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]">
              <img src={adminApi.receiptUrl(b.code)} alt="The player's payment receipt" onError={() => setImageFailed(true)} className="mx-auto max-h-80 w-auto object-contain" />
              <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-zinc-950/80 px-2.5 py-1 text-xs font-semibold text-white">
                <Maximize2 className="h-3 w-3" /> Tap to enlarge
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-6 text-sm text-zinc-500">
              <ImageOff className="h-5 w-5" /> The image was deleted after a week. What was read from it is below.
            </div>
          )}
        </div>
      )}

      <div className="px-4 pt-3">
        <Label className="flex items-center gap-1.5">
          <ScanText className="h-3.5 w-3.5" /> {scan ? `Read from the ${PROVIDER_LABEL[scan.provider ?? 'other'] ?? ''} receipt` : b.proofType === 'reference' ? 'Typed in by the player' : 'Nothing could be read'}
        </Label>
      </div>
      <dl className="divide-y divide-zinc-100 px-4">
        {scan ? (
          <>
            <ReadRow label="Amount" ok={!codes.has('amount_mismatch') && !codes.has('amount_missing')} hint={`Booking total ${peso(b.total)}`}>
              {scan.amount != null ? peso(scan.amount) : 'Not found'}
            </ReadRow>
            <ReadRow label="Reference" ok={!codes.has('reference_missing')} action={scan.reference ? <CopyButton value={scan.reference} /> : undefined}>
              <span className="font-mono tracking-wide">{scan.reference ?? 'Not found'}</span>
            </ReadRow>
            <ReadRow label="Paid" ok={!codes.has('time_outside') && !codes.has('time_missing')} hint={`Booking window ${to ? `${from} – ${to}` : `from ${from}`}`}>
              {scan.paidAt ? stamp(scan.paidAt) : 'Not found'}
            </ReadRow>
            <ReadRow label="Sent to" ok={!codes.has('recipient_mismatch') && !codes.has('recipient_missing')}>
              {[scan.recipientName, scan.recipientNumber].filter(Boolean).join(' · ') || 'Not found'}
            </ReadRow>
          </>
        ) : b.proofType === 'reference' ? (
          <>
            <ReadRow label="Reference" action={b.referenceNumber ? <CopyButton value={b.referenceNumber} /> : undefined}>
              <span className="font-mono tracking-wide">{b.referenceNumber}</span>
            </ReadRow>
            {b.paidAt && <ReadRow label="Paid at" hint={`Booking window ${to ? `${from} – ${to}` : `from ${from}`}`}>{stamp(b.paidAt)}</ReadRow>}
            {b.payerName && <ReadRow label="Sent by">{b.payerName}</ReadRow>}
            <ReadRow label="Amount due">{peso(b.total)}</ReadRow>
          </>
        ) : (
          <ReadRow label="Amount due" hint={`Booking window ${to ? `${from} – ${to}` : `from ${from}`}`}>{peso(b.total)}</ReadRow>
        )}
      </dl>
      {scan?.rawText && (
        <details className="mx-4 mb-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer font-semibold text-zinc-700">All text found on the receipt</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{scan.rawText}</pre>
        </details>
      )}
      <p className="px-4 pb-3 text-xs text-zinc-500">
        Paid with the {METHOD_LABEL[b.paymentMethod]} QR. The reading is automatic and can be wrong, so trust your {METHOD_LABEL[b.paymentMethod]} app over it.
      </p>
    </Card>
  );
};

const Timeline: React.FC<{ b: AdminBookingDetail }> = ({ b }) => {
  const items: { at: string; title: string; detail?: string | null }[] = [{ at: b.createdAt, title: b.source === 'online' ? 'Booked online' : 'Added' }];
  if (b.submittedAt && b.source === 'online')
    items.push({ at: b.submittedAt, title: `${b.proofType === 'receipt' ? 'Receipt uploaded' : 'Reference typed in'} · confirmed automatically` });
  if (b.status === 'expired' && b.closedAt) items.push({ at: b.closedAt, title: 'Payment window ran out' });
  if (b.status === 'cancelled' && b.closeReason === 'customer' && b.closedAt) items.push({ at: b.closedAt, title: 'Cancelled by the player' });
  for (const e of b.events) items.push({ at: e.createdAt, title: EVENT_LABEL[e.action] ?? e.action, detail: e.detail });
  items.sort((x, y) => (x.at < y.at ? 1 : -1));

  return (
    <Card className="p-4">
      <Label>History</Label>
      <ol className="mt-3 space-y-3.5">
        {items.map((it, i) => (
          <li key={`${it.at}-${i}`} className="flex gap-3">
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i === 0 ? 'bg-[#15803D]' : 'bg-zinc-300')} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-zinc-900">{it.title}</span>
              {it.detail && <span className="block text-sm text-zinc-500">{it.detail}</span>}
            </span>
            <span className="shrink-0 text-xs text-zinc-400">{stamp(it.at)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
};

const Lightbox: React.FC<{ code: string; onClose: () => void }> = ({ code, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Receipt, full size">
      <div className="flex items-center justify-between p-3 text-white">
        <a href={adminApi.receiptUrl(code)} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10">
          Open in a new tab
        </a>
        <button type="button" onClick={onClose} aria-label="Close" autoFocus className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 cursor-pointer">
          <X className="h-6 w-6" />
        </button>
      </div>
      <button type="button" onClick={onClose} className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-2" aria-label="Close">
        <img src={adminApi.receiptUrl(code)} alt="The player's payment receipt, full size" className="max-h-full max-w-full object-contain" />
      </button>
    </div>
  );
};
