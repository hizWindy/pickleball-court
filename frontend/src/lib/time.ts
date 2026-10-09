// Everything is shown in Manila time, whatever timezone the visitor's phone is set to.
const TZ = 'Asia/Manila';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const shortDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "7:00 PM" */
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));

/** "7 PM", "12 AM" */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "7:00 PM" from a bare hour */
export function hourTimeLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

// Calendar dates (YYYY-MM-DD) are handled as UTC noon so no timezone can shift them.
const asDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

export function fmtDate(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(asDate(ymd));
}

export function addDays(ymd: string, days: number): string {
  const d = asDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((asDate(b).getTime() - asDate(a).getTime()) / 86_400_000);
}

/** Manila calendar date of an instant. */
export const manilaYmd = (iso: string | number | Date) => ymdFmt.format(new Date(iso));

/** Today's play day: 12 AM - 5:59 AM still belongs to the previous night. */
export function currentPlayDate(nowMs: number): string {
  const ymd = manilaYmd(nowMs);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(nowMs));
  return hour < 6 ? addDays(ymd, -1) : ymd;
}

/** "Sat, Oct 10 · 7:00 – 9:00 PM", noting when the session runs past midnight. */
export function fmtSchedule(startAt: string, endAt: string): { day: string; time: string; note?: string } {
  const startDay = manilaYmd(startAt);
  const endDay = manilaYmd(new Date(Date.parse(endAt) - 1));
  const day = shortDateFmt.format(new Date(startAt));
  const time = `${fmtTime(startAt)} – ${fmtTime(endAt)}`;
  if (startDay !== endDay) return { day, time, note: `Ends ${shortDateFmt.format(new Date(endAt))}` };
  return { day, time };
}

/** For after-midnight starts on a play day: "Early Sun, Oct 11". */
export function afterMidnightNote(playDate: string, hour: number): string | undefined {
  if (hour >= 6) return undefined;
  return `Early ${fmtDate(addDays(playDate, 1))}`;
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const pesoExact = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "₱500" for whole pesos, "₱500.50" when there are centavos (receipt amounts can have them). */
export const pesoAuto = (n: number) => (Number.isInteger(n) ? peso(n) : pesoExact(n));

/** 10 PM - 5:59 AM is the night-owl rate. */
export const isNightHour = (hour: number) => hour >= 22 || hour < 6;

/** "1 hr", "2 hrs" */
export const hrsLabel = (n: number) => `${n} hr${n === 1 ? '' : 's'}`;
