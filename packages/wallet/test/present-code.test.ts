import { describe, expect, it } from 'vitest';
import {
  isPresentCodeValid,
  issuePresentCode,
  normalizeVoucherCode,
  PRESENT_CODE_RULES,
} from '../src';

const SECRET = 'test-secret';
// The start of a window, so the arithmetic below is exact.
const WINDOW_MS = PRESENT_CODE_RULES.windowSeconds * 1000;
const START = new Date(Math.floor(Date.parse('2026-11-04T10:00:00Z') / WINDOW_MS) * WINDOW_MS);
const at = (ms: number) => new Date(START.getTime() + ms);
const voucher = { id: 'voucher-1', expiresAt: '2026-12-01T00:00:00Z' };

describe('present codes', () => {
  it('is six digits and the same within a window, for the same voucher', () => {
    const first = issuePresentCode(voucher, START, SECRET);
    expect(first.code).toMatch(/^\d{6}$/);
    expect(issuePresentCode(voucher, at(WINDOW_MS - 1), SECRET).code).toBe(first.code);
  });

  it('changes with the window, the voucher and the secret', () => {
    const code = issuePresentCode(voucher, START, SECRET).code;
    expect(issuePresentCode(voucher, at(WINDOW_MS), SECRET).code).not.toBe(code);
    expect(issuePresentCode({ ...voucher, id: 'voucher-2' }, START, SECRET).code).not.toBe(code);
    expect(issuePresentCode(voucher, START, 'other-secret').code).not.toBe(code);
  });

  it('accepts the current and previous window and refuses anything older', () => {
    const code = issuePresentCode(voucher, START, SECRET).code;
    expect(isPresentCodeValid(voucher.id, code, START, SECRET)).toBe(true);
    expect(isPresentCodeValid(voucher.id, code, at(WINDOW_MS), SECRET)).toBe(true);
    expect(isPresentCodeValid(voucher.id, code, at(2 * WINDOW_MS - 1), SECRET)).toBe(true);
    expect(isPresentCodeValid(voucher.id, code, at(2 * WINDOW_MS), SECRET)).toBe(false);
  });

  it('refuses a code from a future window', () => {
    const later = issuePresentCode(voucher, at(WINDOW_MS), SECRET).code;
    expect(isPresentCodeValid(voucher.id, later, START, SECRET)).toBe(false);
  });

  it('refuses another voucher, another secret and anything that is not the code', () => {
    const code = issuePresentCode(voucher, START, SECRET).code;
    expect(isPresentCodeValid('voucher-2', code, START, SECRET)).toBe(false);
    expect(isPresentCodeValid(voucher.id, code, START, 'other-secret')).toBe(false);
    for (const wrong of ['', '12345', `${code}0`, 'abcdef', '১২৩৪৫৬']) {
      expect(isPresentCodeValid(voucher.id, wrong, START, SECRET)).toBe(false);
    }
  });

  it('promises two minutes, and always keeps that promise', () => {
    // The worst case: issued in the last moment of a window.
    const issuedAt = at(WINDOW_MS - 1);
    const issued = issuePresentCode(voucher, issuedAt, SECRET);
    expect(issued.validForSeconds).toBe(120);
    expect(issued.expiresAt).toBe(new Date(issuedAt.getTime() + 120_000).toISOString());
    expect(isPresentCodeValid(voucher.id, issued.code, new Date(issued.expiresAt), SECRET)).toBe(
      true,
    );
  });

  it('never promises more than the voucher has left', () => {
    const closing = { ...voucher, expiresAt: at(30_000).toISOString() };
    expect(issuePresentCode(closing, START, SECRET)).toMatchObject({
      validForSeconds: 30,
      expiresAt: closing.expiresAt,
    });
  });

  it('refuses to work without a secret', () => {
    expect(() => issuePresentCode(voucher, START, '')).toThrow();
    expect(() => isPresentCodeValid(voucher.id, '123456', START, '')).toThrow();
  });
});

describe('normalizeVoucherCode', () => {
  it('accepts a code however it was typed', () => {
    for (const typed of [
      'SC-7KQ2-M9XT',
      'sc-7kq2-m9xt',
      ' SC 7KQ2 M9XT ',
      'SC7KQ2M9XT',
      '7kq2m9xt',
    ]) {
      expect(normalizeVoucherCode(typed)).toBe('SC-7KQ2-M9XT');
    }
  });

  it('keeps a code whose own characters start with SC', () => {
    expect(normalizeVoucherCode('SCAB-M9XT')).toBe('SC-SCAB-M9XT');
    expect(normalizeVoucherCode('SC-SCAB-M9XT')).toBe('SC-SCAB-M9XT');
  });
});
