import { describe, expect, it } from 'vitest';
import { courtNames, priceBooking } from './helpers';
import type { CourtConfig } from '../../types';

// The club's rates: Morning (5 AM - 6 PM) ₱200, Evening (6 PM - 5 AM) ₱250, paddles ₱80 a pair.
const C1: CourtConfig = { id: 'court-1', name: 'Court 1', dayRate: 200, nightRate: 250 };
const C2: CourtConfig = { id: 'court-2', name: 'Court 2', dayRate: 200, nightRate: 250 };
const BOTH = [C1, C2];
const FEE = 80;

describe('the price of one court or both', () => {
  it('both courts 7-9 PM is 2 x 2 x ₱250 = ₱1,000 (the plan example)', () => {
    const p = priceBooking(BOTH, 19, 2, false, FEE);
    expect(p.total).toBe(1000);
    expect(p.courts.map((c) => c.total)).toEqual([500, 500]);
  });

  it.each([
    // [label, start hour, hours, one court, both courts]
    ['all Morning', 9, 2, 400, 800],
    ['all Evening', 20, 3, 750, 1500],
    ['across 6 PM', 17, 2, 450, 900],
    ['across 5 AM (the end of the Evening rate)', 4, 2, 450, 900],
    ['past midnight', 23, 3, 750, 1500],
    ['a whole play day', 5, 24, 13 * 200 + 11 * 250, 2 * (13 * 200 + 11 * 250)],
  ])('%s: each court on its own, added up', (_, hour, hours, one, both) => {
    expect(priceBooking([C1], hour, hours, false, FEE).total).toBe(one);
    expect(priceBooking(BOTH, hour, hours, false, FEE).total).toBe(both);
  });

  it('rents one pair of paddles per court', () => {
    expect(priceBooking([C1], 19, 1, true, FEE)).toMatchObject({ courtCost: 250, addons: 80, total: 330 });
    expect(priceBooking(BOTH, 19, 1, true, FEE)).toMatchObject({ courtCost: 500, addons: 160, total: 660 });
  });

  it('prices each court at its own rates', () => {
    const premium: CourtConfig = { id: 'court-3', name: 'Court 3', dayRate: 300, nightRate: 400 };
    const p = priceBooking([C1, premium], 17, 2, false, FEE);
    expect(p.courts.map((c) => c.courtCost)).toEqual([450, 700]);
    expect(p.total).toBe(1150);
  });

  it('lists the hours of each court with their rate group', () => {
    const [first] = priceBooking([C1], 17, 2, false, FEE).courts;
    expect(first.hours).toEqual([
      { hour: 17, rate: 200, night: false },
      { hour: 18, rate: 250, night: true },
    ]);
  });

  it('names the courts the way the pass does', () => {
    expect(courtNames([C1])).toBe('Court 1');
    expect(courtNames(BOTH)).toBe('Court 1 & Court 2');
  });
});
