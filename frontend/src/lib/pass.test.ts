import { describe, expect, it } from 'vitest';
import { passState } from './pass';
import type { Booking } from '../types';

const base = {
  code: 'HPC-AAAA-BBBB', status: 'confirmed', late: false, weatherHold: false, arrived: false, paidLate: false,
  pendingReason: null,
} as unknown as Booking;
const with_ = (patch: Partial<Booking>) => ({ ...base, ...patch }) as Booking;

describe('what the pass says', () => {
  it('a Late booking: the host may give the court to others (it is no longer released by itself)', () => {
    const s = passState(with_({ late: true }));
    expect(s.key).toBe('late');
    expect(s.hint).toMatch(/host may give it to others/);
    expect(s.hint).not.toMatch(/was released/);
  });

  it('a payment after the time ran out, with the slot taken, is not just "Expired"', () => {
    const s = passState(with_({ status: 'expired', paidLate: true }));
    expect(s).toMatchObject({ key: 'paid_late', label: 'Payment received', tone: 'amber' });
    expect(s.hint).toMatch(/host will contact you/);
    expect(passState(with_({ status: 'expired' })).key).toBe('expired');
  });

  it('a rain delay still asks for a new time', () => {
    expect(passState(with_({ weatherHold: true })).key).toBe('rain');
  });
});
