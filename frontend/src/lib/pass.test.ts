import { describe, expect, it } from 'vitest';
import { courtsLine, passState } from './pass';
import type { Booking, BookingCourt } from '../types';

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

describe('the courts on a pass', () => {
  const court = (n: number, status: BookingCourt['status'] = 'confirmed'): BookingCourt => ({
    courtId: `court-${n}`, courtName: `Court ${n}`, status, total: 500,
  });

  it('one court', () => {
    expect(courtsLine(with_({ courtName: 'Court 2', courts: [court(2)] }))).toEqual({ label: 'Court', value: 'Court 2', note: undefined });
  });

  it('both courts at once', () => {
    expect(courtsLine(with_({ courtName: 'Court 1 & Court 2', courts: [court(1), court(2)] }))).toMatchObject({
      label: 'Courts', value: 'Court 1 & Court 2', note: undefined,
    });
  });

  it('both courts, one of them ended by the host: the pass says so', () => {
    const line = courtsLine(with_({ courtName: 'Court 1', courts: [court(1), court(2, 'cancelled')] }));
    expect(line).toEqual({ label: 'Court', value: 'Court 1', note: 'Court 2 is no longer part of this booking' });
  });

  it('a whole booking rejected keeps both courts and adds no note', () => {
    const line = courtsLine(with_({ status: 'rejected', courtName: 'Court 1 & Court 2', courts: [court(1, 'rejected'), court(2, 'rejected')] }));
    expect(line).toMatchObject({ label: 'Courts', note: undefined });
  });

  it('a booking from an older server (no list of courts)', () => {
    expect(courtsLine(with_({ courtName: 'Court 1' }))).toMatchObject({ label: 'Court', value: 'Court 1' });
  });
});
