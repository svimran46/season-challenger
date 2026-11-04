import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Holder proof at the till. A voucher code on its own could be sold or passed on, so a partner
 * also needs a present code, which only the signed-in holder can get from the API. It is
 * stateless: an HMAC of the voucher id and the current time window, so nothing is stored and a
 * screenshot of one stops working by itself.
 *
 * A code is accepted in its own window and the next one. It therefore works for at least
 * `windowSeconds` after it is shown (a cashier mid-way through typing it is not refused) and
 * never for more than twice that.
 */
export const PRESENT_CODE_RULES = {
  digits: 6,
  windowSeconds: 120,
} as const;

const windowOf = (now: Date) =>
  Math.floor(now.getTime() / (PRESENT_CODE_RULES.windowSeconds * 1000));

function codeForWindow(voucherId: string, window: number, secret: string): string {
  if (!secret) throw new Error('The present code secret is empty.');
  const mac = createHmac('sha256', secret)
    .update(`voucher-present:v1:${voucherId}:${window}`)
    .digest();
  // Dynamic truncation from RFC 4226, the same way one-time passwords get their digits.
  const offset = mac[mac.length - 1]! & 0x0f;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** PRESENT_CODE_RULES.digits).padStart(PRESENT_CODE_RULES.digits, '0');
}

export interface PresentCode {
  code: string;
  /** How long the holder is told it works. Counting this down needs no trust in the phone's clock. */
  validForSeconds: number;
  expiresAt: string;
}

/** The code the holder shows right now. Its promised life stops at the voucher's own expiry. */
export function issuePresentCode(
  voucher: { id: string; expiresAt: string },
  now: Date,
  secret: string,
): PresentCode {
  const untilVoucherExpires = Math.floor((Date.parse(voucher.expiresAt) - now.getTime()) / 1000);
  const validForSeconds = Math.max(
    0,
    Math.min(PRESENT_CODE_RULES.windowSeconds, untilVoucherExpires),
  );
  return {
    code: codeForWindow(voucher.id, windowOf(now), secret),
    validForSeconds,
    expiresAt: new Date(now.getTime() + validForSeconds * 1000).toISOString(),
  };
}

/** True for this voucher's code in the current or previous window. Compares in constant time. */
export function isPresentCodeValid(
  voucherId: string,
  code: string,
  now: Date,
  secret: string,
): boolean {
  const given = Buffer.from(code);
  const current = windowOf(now);
  let valid = false;
  for (const window of [current, current - 1]) {
    const expected = Buffer.from(codeForWindow(voucherId, window, secret));
    if (given.length === expected.length && timingSafeEqual(given, expected)) valid = true;
  }
  return valid;
}
