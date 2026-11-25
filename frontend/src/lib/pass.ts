import QRCode from 'qrcode';
import type { Booking, BookingStatus } from '../types';
import { COURT_DETAILS } from '../data/mockData';
import { paymentLabel } from './payment';
import { downloadBlob } from './saveImage';
import { fmtReference, fmtSchedule, peso } from './time';

export type PassTone = 'green' | 'amber' | 'red' | 'blue' | 'zinc';

export interface PassState {
  /** Short key for the situation, handy for tests and styling. */
  key: BookingStatus | 'late' | 'rain' | 'arrived' | 'paid_late';
  label: string;
  tone: PassTone;
  hint: string;
}

export const STATUS_COPY: Record<BookingStatus, Omit<PassState, 'key'>> = {
  held: { label: 'Awaiting payment', tone: 'amber', hint: 'Finish payment to keep this slot.' },
  pending_verification: {
    label: 'Payment under review',
    tone: 'amber',
    hint: 'Your slot is reserved. The host is checking your payment.',
  },
  confirmed: { label: 'Confirmed', tone: 'green', hint: 'All set. Show this pass when you arrive.' },
  rejected: { label: 'Payment not verified', tone: 'red', hint: 'Please contact the host about this booking.' },
  expired: { label: 'Expired', tone: 'zinc', hint: 'The payment window ran out and the slot was released.' },
  cancelled: { label: 'Cancelled', tone: 'zinc', hint: 'This booking is closed and the slot is free again.' },
};

/**
 * What the pass should say right now. A paid booking can be Late (the host may give the court to others),
 * Rain delay (the host moved everyone) or Checked in, and none of those may read "Confirmed". A hold that ran out but
 * was paid while someone else had the slot says so, not just "Expired".
 */
export function passState(booking: Booking): PassState {
  if (booking.status === 'expired' && booking.paidLate) {
    return { key: 'paid_late', label: 'Payment received', tone: 'amber', hint: 'Someone else booked the slot first. The host will contact you to move or refund it.' };
  }
  if (booking.status === 'confirmed') {
    if (booking.weatherHold) {
      return { key: 'rain', label: 'Rain delay', tone: 'blue', hint: 'The courts were closed for rain. Pick a new time.' };
    }
    if (booking.late) {
      return { key: 'late', label: 'Late', tone: 'zinc', hint: 'You weren\'t on court in time, so the host may give it to others. Please contact the host.' };
    }
    if (booking.arrived) {
      return { key: 'arrived', label: 'Checked in', tone: 'green', hint: "You're checked in. Have a great game!" };
    }
  }
  if (booking.status === 'pending_verification' && booking.pendingReason === 'amount_short') {
    return { key: booking.status, label: 'Payment short', tone: 'amber', hint: 'Your receipt looks short. The host is checking it.' };
  }
  if (booking.status === 'pending_verification' && booking.pendingReason === 'amount_unreadable') {
    return { key: booking.status, label: 'Payment under review', tone: 'amber', hint: 'The host is reading your receipt.' };
  }
  return { key: booking.status, ...STATUS_COPY[booking.status] };
}

/**
 * The courts line of a pass: "Court 1", or "Court 1 & Court 2" for a booking of both. If the host ended one court of a
 * two-court booking (the group was smaller, say), the pass shows the court still on and says the other one is off.
 */
export function courtsLine(booking: Booking): { label: string; value: string; note?: string } {
  const courts = booking.courts ?? [];
  const off = courts.filter((c) => c.status !== booking.status && (c.status === 'cancelled' || c.status === 'rejected'));
  const on = Math.max(1, courts.length - off.length);
  const names = off.map((c) => c.courtName).join(' & ');
  return {
    label: on > 1 ? 'Courts' : 'Court',
    value: booking.courtName,
    note: off.length ? `${names} ${off.length > 1 ? 'are' : 'is'} no longer part of this booking` : undefined,
  };
}

/** The QR opens this booking on the site, so staff always see the live status, never a stale image. */
export const passUrl = (code: string) => `${window.location.origin}/?pass=${encodeURIComponent(code)}`;

export const qrDataUrl = (code: string, size = 320) =>
  QRCode.toDataURL(passUrl(code), { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B1F12', light: '#FFFFFF' } });

const W = 1080;
const H = 1640;
const GREEN = '#15803D';
const LIME = '#D2EE5E';
const INK = '#0B1F12';
const MUTED = '#5B6B60';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, weight: number, family: string) {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 20);
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Draws the pass as a phone-friendly PNG (portrait, saves cleanly to Photos). */
export async function renderPassPng(booking: Booking): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const heading = "'Space Grotesk', 'Segoe UI', sans-serif";
  const body = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  const status = passState(booking);

  // Background + card
  ctx.fillStyle = '#EEF6EF';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(11,31,18,0.12)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, 60, 60, W - 120, H - 120, 48);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Header band
  ctx.save();
  roundRect(ctx, 60, 60, W - 120, 300, 48);
  ctx.clip();
  const grad = ctx.createLinearGradient(60, 60, W - 60, 360);
  grad.addColorStop(0, GREEN);
  grad.addColorStop(1, '#0B3D1C');
  ctx.fillStyle = grad;
  ctx.fillRect(60, 60, W - 120, 300);
  ctx.restore();

  ctx.fillStyle = LIME;
  ctx.font = `800 30px ${body}`;
  ctx.fillText('COURT PASS', 120, 150);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 76px ${heading}`;
  ctx.fillText('HousePickle Club', 120, 240);
  ctx.font = `500 30px ${body}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('Play • Connect • Repeat', 120, 295);

  // Status pill
  const tones: Record<PassTone, [string, string]> = {
    green: ['#DCFCE7', '#166534'],
    amber: ['#FEF3C7', '#92400E'],
    red: ['#FEE2E2', '#991B1B'],
    blue: ['#E0F2FE', '#075985'],
    zinc: ['#F4F4F5', '#3F3F46'],
  };
  const [pillBg, pillInk] = tones[status.tone];
  ctx.font = `700 32px ${body}`;
  const pillW = ctx.measureText(status.label).width + 72;
  roundRect(ctx, 120, 410, pillW, 68, 34);
  ctx.fillStyle = pillBg;
  ctx.fill();
  ctx.fillStyle = pillInk;
  ctx.fillText(status.label, 156, 456);

  // Reservation code
  ctx.fillStyle = MUTED;
  ctx.font = `600 28px ${body}`;
  ctx.fillText('RESERVATION NO.', 120, 560);
  ctx.fillStyle = INK;
  ctx.font = `800 96px ${heading}`;
  ctx.fillText(booking.code, 120, 660);
  if (booking.paymentReference) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 28px ${body}`;
    ctx.fillText(`PAYMENT REF  ${fmtReference(booking.paymentReference)}`, 120, 712);
  }

  // Details grid
  const sched = fmtSchedule(booking.startAt, booking.endAt);
  const courts = courtsLine(booking);
  const rows: [string, string][] = [
    ['PLAYER', booking.customerName],
    [courts.label.toUpperCase(), booking.courtName],
    ['DATE', sched.note ? `${sched.day} (${sched.note})` : sched.day],
    ['TIME', `${sched.time}  ·  ${booking.hours} hr${booking.hours > 1 ? 's' : ''}`],
    [
      'TOTAL',
      `${peso(booking.total)} via ${paymentLabel(booking.paymentMethod)}${booking.paddles ? `  ·  incl. paddles${courts.label === 'Courts' ? ' for each court' : ''}` : ''}`,
    ],
  ];
  let y = 760;
  for (const [label, value] of rows) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 26px ${body}`;
    ctx.fillText(label, 120, y);
    ctx.fillStyle = INK;
    fitText(ctx, value, W - 240, 44, 700, heading);
    ctx.fillText(value, 120, y + 52);
    y += 116;
  }

  // Divider (ticket perforation)
  ctx.strokeStyle = '#D4E3D7';
  ctx.setLineDash([14, 12]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(110, 1336);
  ctx.lineTo(W - 110, 1336);
  ctx.stroke();
  ctx.setLineDash([]);

  // Footer: venue info on the left, QR on the right
  const qrSize = 184;
  const qr = await loadImage(await qrDataUrl(booking.code, 400));
  ctx.drawImage(qr, W - 120 - qrSize, 1366, qrSize, qrSize);

  ctx.fillStyle = INK;
  ctx.font = `700 30px ${body}`;
  ctx.fillText('Show this pass when you arrive.', 120, 1400);
  ctx.fillStyle = MUTED;
  ctx.font = `500 25px ${body}`;
  ctx.fillText('Scan the QR to check its live status.', 120, 1442);
  ctx.fillText('In front of Aloha Suites, Brgy. San Isidro,', 120, 1490);
  ctx.fillText(`Koronadal City  ·  Host ${COURT_DETAILS.contactNumber}`, 120, 1528);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png'));
}

export const passFileName = (b: Booking) => `HousePickle-Pass-${b.code}.png`;

/** Download the pass without asking (the automatic save right after payment). Saving on tap uses saveImage. */
export async function downloadPass(booking: Booking): Promise<void> {
  downloadBlob(await renderPassPng(booking), passFileName(booking));
}
