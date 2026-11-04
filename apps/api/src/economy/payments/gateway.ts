import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PayoutChannel } from '@season/wallet';

/**
 * What a deposit gateway does: hand back a hosted checkout URL for an invoice. Verifying the
 * webhook lives with `verifyWebhookSignature`, because every adapter that wants to plug in
 * signs its callbacks the same way (HMAC-SHA256 over the raw body, hex, in the
 * x-season-signature header) — so the API can swap gateways without new credit logic.
 */
export interface PaymentGateway {
  /** Shown on invoices, e.g. "mock" in development. */
  readonly id: string;
  /** The checkout URL the app opens in a browser or WebView. */
  createCheckout(invoice: {
    id: string;
    userId: string;
    amountBdt: number;
    coins: number;
    channel: PayoutChannel;
    expiresAt: string;
  }): Promise<string>;
}

/**
 * Development gateway. The checkout URL is this API's own simulation page, which accepts the
 * payment the way a bKash-class web checkout would and calls the server's webhook with a
 * valid signature. Production replaces this with the bKash Tokenized Checkout adapter.
 */
export class MockGateway implements PaymentGateway {
  readonly id = 'mock';

  constructor(private readonly apiPublicUrl: string) {}

  async createCheckout(invoice: { id: string }): Promise<string> {
    return `${this.apiPublicUrl}/v1/payments/mock/checkout/${encodeURIComponent(invoice.id)}`;
  }
}

/** Hex HMAC-SHA256 over the exact raw body the gateway sent. */
export function signWebhookBody(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

export function verifyWebhookSignature(
  raw: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = signWebhookBody(raw, secret);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** The JSON shape every delivery carries, straight from the Game of 11 webhook flow. */
export interface WebhookDelivery {
  eventId: string;
  paymentId: string;
  status: 'paid' | 'failed' | 'refund';
  amountBdt?: number;
}
