import React from 'react';
import { Check, DoorOpen, MessageSquare, Phone, RotateCcw } from 'lucide-react';
import { fmtCountdown } from '../lib/time';
import { arrivable, restoreLeft, smsHref, telHref } from './format';
import { useNow } from './hooks';
import { lateMessage, rainMessage } from './messages';
import { Btn, cx, LinkBtn } from './ui';
import type { QuickApi } from './useQuickActions';
import type { AdminBooking } from './types';

type Size = 'sm' | 'md' | 'lg';

/** Restore a Late booking (with a quiet countdown) or undo a rain delay. Gone as soon as the time is up. */
export const RestoreBtn: React.FC<{ b: AdminBooking; q: QuickApi; size?: Size; variant?: 'primary' | 'outline'; className?: string }> = ({
  b,
  q,
  size = 'md',
  variant = 'primary',
  className,
}) => {
  const now = useNow(1000);
  const left = restoreLeft(b, now);
  if (left === null) return null;
  const rain = b.label === 'rain_delay';
  return (
    <Btn variant={variant} size={size} className={className} loading={q.busy === `restore:${b.code}`} disabled={!!q.busy} onClick={() => q.restore(b)}>
      <RotateCcw className="h-4 w-4" />
      <span className="whitespace-nowrap">{rain ? 'Undo rain delay' : 'Restore'}</span>
      {left !== Infinity && <span className="whitespace-nowrap font-medium tabular-nums opacity-80">· {fmtCountdown(left)} left</span>}
    </Btn>
  );
};

/** "They're here": stops a booking going Late, and ends a Late one. Only offered when the session is close or under way. */
export const ArrivedBtn: React.FC<{ b: AdminBooking; q: QuickApi; now: number; size?: Size; className?: string }> = ({ b, q, now, size = 'md', className }) => {
  if (!arrivable(b, now)) return null;
  return (
    <Btn variant="primary" size={size} className={className} loading={q.busy === `arrived:${b.code}`} disabled={!!q.busy} onClick={() => q.arrived(b)}>
      <Check className="h-4 w-4" strokeWidth={3} /> Arrived
    </Btn>
  );
};

/** Release court (a Late group that isn't coming) or Open hours (a rain delay): the hours go back on sale. */
export const ReleaseBtn: React.FC<{ b: AdminBooking; q: QuickApi; size?: Size; className?: string }> = ({ b, q, size = 'md', className }) => {
  if (!b.canRelease) return null;
  return (
    <Btn variant="outline" size={size} className={className} loading={q.busy === `release:${b.code}`} disabled={!!q.busy} onClick={() => q.release(b)}>
      <DoorOpen className="h-4 w-4" /> {b.label === 'rain_delay' ? 'Open hours' : 'Release court'}
    </Btn>
  );
};

/** Call and Text, one tap each. Nothing at all when there's no number. */
export const ContactBtns: React.FC<{ b: Pick<AdminBooking, 'customerName' | 'customerPhone'>; message: string; size?: Size; className?: string }> = ({
  b,
  message,
  size = 'md',
  className,
}) => {
  if (!b.customerPhone) return null;
  return (
    <>
      <LinkBtn href={telHref(b.customerPhone)} size={size} className={className} aria-label={`Call ${b.customerName}`}>
        <Phone className="h-4 w-4" /> Call
      </LinkBtn>
      <LinkBtn href={smsHref(b.customerPhone, message)} size={size} className={className} aria-label={`Text ${b.customerName}`}>
        <MessageSquare className="h-4 w-4" /> Text
      </LinkBtn>
    </>
  );
};

/**
 * The one-tap actions a booking row can carry: on a Late one that still holds its court, Arrived and Release court; on a
 * released Late one, Restore; on a rain delay, Open hours and Undo; Call and Text on both; Arrived on a paid one that is
 * starting. Renders nothing when there is nothing to do.
 */
export const RowActions: React.FC<{ b: AdminBooking; q: QuickApi; now: number; className?: string }> = ({ b, q, now, className }) => {
  if (b.label === 'late' && b.holdsCourt) {
    // The court is still theirs until the host decides: here after all, or let others have it.
    if (!arrivable(b, now) && !b.canRelease && !b.customerPhone) return null;
    return (
      <div className={cx('flex flex-wrap gap-2', className)}>
        <div className="flex w-full gap-2 xs:w-auto xs:flex-1 sm:max-w-sm">
          <ArrivedBtn b={b} q={q} now={now} className="flex-1" />
          <ReleaseBtn b={b} q={q} className="flex-1" />
        </div>
        <ContactBtns b={b} message={lateMessage(b)} className="flex-1 xs:flex-none" />
      </div>
    );
  }
  if (b.label === 'late' || b.label === 'rain_delay') {
    const canRestore = restoreLeft(b, now) !== null;
    if (!b.customerPhone && !canRestore && !b.canRelease) return null;
    return (
      // Restore gets its own full-width line on a phone (the countdown needs the room); Call and Text share the next.
      <div className={cx('flex flex-wrap gap-2', className)}>
        <ContactBtns b={b} message={b.label === 'late' ? lateMessage(b) : rainMessage(b)} className="flex-1 xs:flex-none" />
        <ReleaseBtn b={b} q={q} className="flex-1 xs:flex-none" />
        {/* Undoing a rain delay is the quieter choice here: the message to the guest comes first */}
        <RestoreBtn b={b} q={q} variant={b.label === 'late' ? 'primary' : 'outline'} className="order-first w-full xs:order-last xs:w-auto xs:min-w-0 xs:flex-1 sm:max-w-sm" />
      </div>
    );
  }
  if (arrivable(b, now)) {
    return (
      <div className={cx('flex gap-2', className)}>
        <ArrivedBtn b={b} q={q} now={now} className="flex-1 sm:max-w-xs" />
      </div>
    );
  }
  return null;
};

const iconBtn =
  'flex h-11 w-11 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-bold leading-none transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] focus-visible:ring-offset-1';

/** Restore, squeezed into a schedule block: an icon with the countdown under it (44 px square, so it's easy to hit). */
export const RestoreIconBtn: React.FC<{ b: AdminBooking; q: QuickApi; className?: string }> = ({ b, q, className }) => {
  const now = useNow(1000);
  const left = restoreLeft(b, now);
  if (left === null) return null;
  return (
    <button
      type="button"
      disabled={!!q.busy}
      onClick={() => q.restore(b)}
      aria-label={left === Infinity ? `Undo rain delay for ${b.customerName}` : `Restore ${b.customerName}, ${fmtCountdown(left)} left`}
      className={cx(iconBtn, 'bg-[#15803D] text-white hover:bg-[#166534]', className)}
    >
      <RotateCcw className={cx('h-4 w-4', q.busy === `restore:${b.code}` && 'animate-spin')} />
      {left !== Infinity && <span className="tabular-nums">{fmtCountdown(left)}</span>}
    </button>
  );
};

/** Arrived, squeezed into a schedule block. */
export const ArrivedIconBtn: React.FC<{ b: AdminBooking; q: QuickApi; now: number; className?: string }> = ({ b, q, now, className }) => {
  if (!arrivable(b, now)) return null;
  return (
    <button
      type="button"
      disabled={!!q.busy}
      onClick={() => q.arrived(b)}
      aria-label={`Mark ${b.customerName} as arrived`}
      className={cx(iconBtn, 'bg-white text-emerald-800 ring-1 ring-emerald-600 hover:bg-emerald-50', className)}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
      <span>Here</span>
    </button>
  );
};

/** Release court / Open hours, squeezed into a schedule block. */
export const ReleaseIconBtn: React.FC<{ b: AdminBooking; q: QuickApi; className?: string }> = ({ b, q, className }) => {
  if (!b.canRelease) return null;
  const rain = b.label === 'rain_delay';
  return (
    <button
      type="button"
      disabled={!!q.busy}
      onClick={() => q.release(b)}
      aria-label={rain ? `Open ${b.customerName}'s hours to others` : `Release the court ${b.customerName} booked`}
      className={cx(iconBtn, 'bg-white text-zinc-800 ring-1 ring-zinc-400 hover:bg-zinc-50', className)}
    >
      <DoorOpen className={cx('h-4 w-4', q.busy === `release:${b.code}` && 'animate-pulse')} />
      <span>{rain ? 'Open' : 'Free'}</span>
    </button>
  );
};
