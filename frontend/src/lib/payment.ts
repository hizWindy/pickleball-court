import type { PaidWith } from '../types';

/** What each way of paying is called on the pass, the pass image and the desk. Add a new method here once. */
export const PAYMENT_LABEL: Record<PaidWith, string> = {
  gcash: 'GCash',
  gotyme: 'GoTyme',
  cash: 'Cash',
  none: '—',
};

/** "GCash", "GoTyme", "Cash"... An unknown method (a newer server) shows as sent rather than as the wrong name. */
export const paymentLabel = (method: string): string => PAYMENT_LABEL[method as PaidWith] ?? method;
