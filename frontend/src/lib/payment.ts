import type { PaidWith, PaymentMethod } from '../types';

/** The small coloured badge each payment app gets on the checkout picker (its own colour and initials). */
export const PAYMENT_BADGE: Record<PaymentMethod, { text: string; colour: string }> = {
  gcash: { text: 'G', colour: '#007DFE' },
  gotyme: { text: 'GT', colour: '#00B0A0' },
  maribank: { text: 'M', colour: '#E86208' },
};

/** What each way of paying is called on the pass, the pass image and the desk. Add a new method here once. */
export const PAYMENT_LABEL: Record<PaidWith, string> = {
  gcash: 'GCash',
  gotyme: 'GoTyme',
  maribank: 'MariBank',
  cash: 'Cash',
  none: '—',
};

/** "GCash", "GoTyme", "MariBank", "Cash"... An unknown method (a newer server) shows as sent, never as another's name. */
export const paymentLabel = (method: string): string => PAYMENT_LABEL[method as PaidWith] ?? method;
