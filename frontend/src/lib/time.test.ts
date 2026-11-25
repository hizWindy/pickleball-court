import { describe, expect, it } from 'vitest';
import { afterMidnightNote, currentPlayDate, DAY_START_HOUR, isAfterMidnight, isNightHour, PLAY_DAY_HOURS, playDayStartMs, slotStartMs } from './time';

/** An instant given in Manila time. */
const manila = (iso: string) => Date.parse(`${iso}+08:00`);

describe('the play day', () => {
  it('starts at 5 AM', () => {
    expect(DAY_START_HOUR).toBe(5);
    expect(PLAY_DAY_HOURS).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4]);
  });

  it('switches at exactly 5:00 AM, not at 4:59 or 6:00', () => {
    expect(currentPlayDate(manila('2026-10-11T04:59:59'))).toBe('2026-10-10');
    expect(currentPlayDate(manila('2026-10-11T05:00:00'))).toBe('2026-10-11');
    expect(currentPlayDate(manila('2026-10-11T05:59:59'))).toBe('2026-10-11');
    expect(currentPlayDate(manila('2026-10-11T00:00:00'))).toBe('2026-10-10');
    expect(currentPlayDate(manila('2026-10-10T23:59:59'))).toBe('2026-10-10');
  });

  it('puts 12-4 AM on the next calendar date', () => {
    expect(slotStartMs('2026-10-10', 5)).toBe(manila('2026-10-10T05:00:00'));
    expect(slotStartMs('2026-10-10', 23)).toBe(manila('2026-10-10T23:00:00'));
    expect(slotStartMs('2026-10-10', 0)).toBe(manila('2026-10-11T00:00:00'));
    expect(slotStartMs('2026-10-10', 4)).toBe(manila('2026-10-11T04:00:00'));
    expect(playDayStartMs('2026-10-10')).toBe(manila('2026-10-10T05:00:00'));
    // across a month end
    expect(slotStartMs('2026-10-31', 2)).toBe(manila('2026-11-01T02:00:00'));
  });

  it('calls only 12-4 AM "after midnight"', () => {
    expect([...PLAY_DAY_HOURS].filter(isAfterMidnight)).toEqual([0, 1, 2, 3, 4]);
    expect(afterMidnightNote('2026-10-10', 5)).toBeUndefined();
    expect(afterMidnightNote('2026-10-10', 4)).toBe('Early Sun, Oct 11');
  });

  it('prices 6 PM to 5 AM as Evening', () => {
    expect(PLAY_DAY_HOURS.filter(isNightHour)).toEqual([18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4]);
  });
});
