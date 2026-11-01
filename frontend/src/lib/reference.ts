/**
 * What a typed payment reference should look like, for instant, friendly feedback while the guest types.
 *
 * The QR codes are InstaPay, so a guest can pay from any app and the reference may be GCash's (13 numbers), GoTyme's
 * (GT + the day + 8 numbers) or another bank's. The shape typed decides the rules, not which QR was picked.
 *
 * This only judges the shape. The server has the last word, and it alone turns away made-up numbers and the wrong
 * day, so those rules are not shipped to the phone (nobody should be able to read how to get around them).
 * Keep the cleaning here in step with `clean_reference` in backend/app/validation.py.
 */

export type RefShape = 'gcash' | 'gotyme' | 'other';

export type RefCheck =
  | { state: 'empty' }
  | { state: 'ok'; shape: RefShape; clean: string }
  | { state: 'hint'; message: string };

export const REFERENCE_FORMAT_HINT = 'Enter the reference exactly as shown on your receipt.';
export const REFERENCE_INSTAPAY_HINT = 'That looks like the short InstaPay number. Use the 13-digit Ref No. from your receipt.';
export const REFERENCE_GCASH_HINT = 'A GCash reference has 13 numbers. Check it against your receipt.';

const INVISIBLE = /[​-‏⁠­﻿]/g;
const LABEL = /^\s*ref(?:erence)?[\s.:#]+(?:(?:no|num|number)\b[\s.:#]*)?/i;
const SEPARATORS = /[\s\-.:]/g;

/** What was typed or pasted, minus a leading "Ref No.", spaces, dashes, dots and invisible characters, in capitals. */
export function cleanReference(raw: string): string {
  const ref = raw.replace(INVISIBLE, '').replace(LABEL, '').replace(SEPARATORS, '').toUpperCase();
  const head = ref.startsWith('GT') ? 'GT' : '';
  let body = ref.slice(head.length);
  // Typed by hand: a letter O for zero, or I or L for one, when the rest are numbers.
  const digits = (body.match(/[0-9]/g) ?? []).length;
  if (body && digits >= body.length - 2) body = body.replace(/O/g, '0').replace(/[IL]/g, '1');
  return head + body;
}

export function checkReference(raw: string): RefCheck {
  const ref = cleanReference(raw);
  if (!ref) return { state: 'empty' };
  if (!/^[\x20-\x7e]+$/.test(ref)) return { state: 'hint', message: REFERENCE_FORMAT_HINT };
  if (/^[0-9]+$/.test(ref)) {
    if (ref.length === 13) return { state: 'ok', shape: 'gcash', clean: ref };
    return { state: 'hint', message: ref.length >= 8 && ref.length <= 12 ? REFERENCE_INSTAPAY_HINT : REFERENCE_GCASH_HINT };
  }
  if (/^GT[0-9]{16}$/.test(ref)) return { state: 'ok', shape: 'gotyme', clean: ref };
  if (/^(?=.*[A-Z])[A-Z0-9]{10,32}$/.test(ref)) return { state: 'ok', shape: 'other', clean: ref };
  return { state: 'hint', message: REFERENCE_FORMAT_HINT };
}

/**
 * Spaces a GCash number the way GCash prints it (4-3-6) so the guest can compare it with the receipt by eye.
 * Only numbers typed on their own are touched; anything else stays exactly as typed. Display only: the server
 * strips the spaces again.
 */
export function formatReference(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '');
  if (!/^[0-9]{1,13}$/.test(compact)) return raw;
  return [compact.slice(0, 4), compact.slice(4, 7), compact.slice(7)].filter(Boolean).join(' ');
}

export const SHAPE_LABEL: Record<RefShape, string> = {
  gcash: 'GCash reference',
  gotyme: 'GoTyme reference',
  other: 'Reference looks right',
};
