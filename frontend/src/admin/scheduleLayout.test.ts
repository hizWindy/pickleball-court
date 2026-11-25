import { describe, expect, it } from 'vitest';
import { hourLabel, PLAY_DAY_HOURS, slotStartMs } from '../lib/time';
import { nextDayHint, PLAY_HOURS, startChoice } from './format';
import { courtHoursBooked, nowOffset, schedulePosition } from './scheduleLayout';

const DAY = '2026-10-10';
const iso = (ms: number) => new Date(ms).toISOString();
/** A booking on the play day DAY, as the server sends it. */
const booking = (hour: number, hours = 1) => ({ startAt: iso(slotStartMs(DAY, hour)), endAt: iso(slotStartMs(DAY, hour) + hours * 3_600_000) });

describe('the Schedule grid', () => {
  it('draws a booking at every hour from 5 AM to 4 AM in the row with the same label', () => {
    for (const hour of PLAY_DAY_HOURS) {
      const { startAt, endAt } = booking(hour);
      const span = schedulePosition(startAt, endAt, DAY);
      expect(span, `${hourLabel(hour)}`).not.toBeNull();
      // The grid's rows are labelled with PLAY_HOURS in order: the booking must start in the row that says its hour.
      expect(hourLabel(PLAY_HOURS[span!.top]), `${hourLabel(hour)}`).toBe(hourLabel(hour));
      expect(span!.bottom - span!.top).toBe(1);
    }
  });

  it('draws a 5 AM booking at the top and a 7 PM booking in the 7 PM row', () => {
    expect(schedulePosition(booking(5).startAt, booking(5).endAt, DAY)).toEqual({ top: 0, bottom: 1 });
    expect(schedulePosition(booking(19, 2).startAt, booking(19, 2).endAt, DAY)).toEqual({ top: 14, bottom: 16 });
  });

  it('clips a booking that runs past the end of the play day, and leaves out other days', () => {
    const late = booking(3, 4); // 3-7 AM: the last two hours belong to the next play day
    expect(schedulePosition(late.startAt, late.endAt, DAY)).toEqual({ top: 22, bottom: 24 });
    expect(schedulePosition(late.startAt, late.endAt, '2026-10-11')).toEqual({ top: 0, bottom: 2 });
    expect(schedulePosition(booking(19).startAt, booking(19).endAt, '2026-10-11')).toBeNull();
  });

  it('puts the Now line at the right height, and only on its own day', () => {
    expect(nowOffset(Date.parse('2026-10-10T05:00:00+08:00'), DAY)).toBe(0);
    expect(nowOffset(Date.parse('2026-10-10T19:30:00+08:00'), DAY)).toBe(14.5);
    expect(nowOffset(Date.parse('2026-10-11T04:59:00+08:00'), DAY)).toBeCloseTo(23.983, 3);
    expect(nowOffset(Date.parse('2026-10-11T05:00:00+08:00'), DAY)).toBeNull(); // that's the next day's grid
    expect(nowOffset(Date.parse('2026-10-10T04:59:00+08:00'), DAY)).toBeNull();
  });

  it('counts the court-hours booked on the day', () => {
    const list = [{ ...booking(5), use: true }, { ...booking(19, 2), use: true }, { ...booking(3, 4), use: true }, { ...booking(9), use: false }];
    expect(courtHoursBooked(list, DAY, (b) => b.use)).toBe(1 + 2 + 2);
  });
});

describe('the hour pickers', () => {
  it('does not call 5 AM "after midnight", and does call 12-4 AM that', () => {
    expect(startChoice(5)).toBe('5:00 AM');
    expect(startChoice(4)).toBe('4:00 AM (after midnight)');
    expect(startChoice(0)).toBe('12:00 AM (after midnight)');
    expect(nextDayHint(DAY, 5)).toBeUndefined();
    expect(nextDayHint(DAY, 23)).toBeUndefined();
    expect(nextDayHint(DAY, 1)).toBe('Runs into early Sun, Oct 11');
  });
});
