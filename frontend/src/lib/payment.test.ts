import { describe, expect, it } from 'vitest';
import { PAYMENT_BADGE, PAYMENT_LABEL, paymentLabel } from './payment';
import type { PaidWith, PaymentMethod } from '../types';

const ONLINE: PaymentMethod[] = ['gcash', 'gotyme', 'maribank'];
const EVERY: PaidWith[] = [...ONLINE, 'cash', 'none'];

describe('payment names', () => {
  it('gives every method its own name: none falls back to GoTyme', () => {
    expect(EVERY.map(paymentLabel)).toEqual(['GCash', 'GoTyme', 'MariBank', 'Cash', '—']);
    expect(new Set(Object.values(PAYMENT_LABEL)).size).toBe(Object.keys(PAYMENT_LABEL).length);
    expect(paymentLabel('maribank')).not.toBe('GoTyme');
  });

  it('shows a method it does not know as sent, not as another one', () => {
    expect(paymentLabel('maya')).toBe('maya');
  });

  it('gives every online method its own badge', () => {
    expect(ONLINE.map((m) => PAYMENT_BADGE[m].text)).toEqual(['G', 'GT', 'M']);
    expect(new Set(ONLINE.map((m) => PAYMENT_BADGE[m].colour)).size).toBe(3);
  });
});
