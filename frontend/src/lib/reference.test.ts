import { describe, expect, it } from 'vitest';
import { checkReference, formatReference, REFERENCE_FORMAT_HINT, REFERENCE_GCASH_HINT, REFERENCE_INSTAPAY_HINT } from './reference';

/** What the server sends for MariBank until its receipts are known (MARIBANK_REFERENCE_DIGITS=10-20). */
const MARIBANK = Array.from({ length: 11 }, (_, i) => 10 + i);

describe('the reference shape check', () => {
  it('takes GCash, GoTyme and other banks the same way as before', () => {
    expect(checkReference('4821 905 337164')).toEqual({ state: 'ok', shape: 'gcash', clean: '4821905337164' });
    expect(checkReference('GT2026101009410293')).toMatchObject({ state: 'ok', shape: 'gotyme' });
    expect(checkReference('7Q3K91XD40ZB')).toMatchObject({ state: 'ok', shape: 'other' });
    expect(checkReference('48219053371')).toEqual({ state: 'hint', message: REFERENCE_INSTAPAY_HINT });
    expect(checkReference('7302551809462261')).toEqual({ state: 'hint', message: REFERENCE_GCASH_HINT });
  });

  it('takes the MariBank examples on a MariBank booking', () => {
    for (const ref of ['7302 5518 0946 2261', '7302551809462261', '1234098765', '73025518094622610023']) {
      expect(checkReference(ref, MARIBANK), ref).toMatchObject({ state: 'ok', shape: 'other' });
    }
    expect(checkReference('4821 905 337164', MARIBANK)).toMatchObject({ state: 'ok', shape: 'gcash' }); // paid from GCash
  });

  it("gives a neutral hint on a MariBank booking, never GCash's", () => {
    expect(checkReference('123456789', MARIBANK)).toEqual({ state: 'hint', message: REFERENCE_FORMAT_HINT });
    expect(checkReference('730255180946226100231', MARIBANK)).toEqual({ state: 'hint', message: REFERENCE_FORMAT_HINT });
  });

  it('spaces GCash numbers 4-3-6 and longer bank numbers in fours', () => {
    expect(formatReference('4821905337164')).toBe('4821 905 337164');
    expect(formatReference('7302551809462261')).toBe('7302 5518 0946 2261');
    expect(formatReference('GT2026101009410293')).toBe('GT2026101009410293');
  });
});
