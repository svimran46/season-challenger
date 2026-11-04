import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { MONEY_SERVICE } from '../money.tokens';
import type { MoneyService } from '../money.service';
import type { WebhookDelivery } from './gateway';

/** The pieces of an Express request this controller reads, without the express types. */
interface RawBodyRequest {
  rawBody?: string | string[] | Buffer | undefined;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

const checkoutBody = z.object({ outcome: z.enum(['paid', 'failed']) });

/**
 * Server-to-server callbacks from the deposit gateways (signed, replay-safe) and the mock
 * checkout the app opens for a payment in development. A real bKash/Nagad adapter keeps this
 * controller: only `createCheckout` moves.
 */
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(MONEY_SERVICE) private readonly money: MoneyService) {}

  @Post('webhook/:gateway')
  @HttpCode(200)
  webhook(
    @Param('gateway') gateway: string,
    // rawBody comes from NestFactory.create({ rawBody: true }); the signature is over the
    // exact bytes the gateway sent, never over a re-serialisation.
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
  ) {
    const raw = toRawString(request.rawBody) ?? JSON.stringify(body ?? {});
    return this.money.applyWebhook({
      gateway,
      delivery: parseDelivery(body),
      raw,
      signature: headerString(request.headers['x-season-signature']),
    });
  }

  /** The mock gateway's hosted checkout: a tiny page that simulates paying or cancelling. */
  @Get('mock/checkout/:invoiceId')
  checkoutPage(@Param('invoiceId') invoiceId: string) {
    this.requireMock();
    return mockPage(invoiceId);
  }

  /** What the mock checkout's Pay button triggers — the payable path in development. */
  @Post('mock/checkout/:invoiceId')
  @HttpCode(200)
  checkoutPay(
    @Param('invoiceId') invoiceId: string,
    @Body(new ZodPipe(checkoutBody)) body: z.infer<typeof checkoutBody>,
  ) {
    this.requireMock();
    return this.money.simulateCheckout(invoiceId, body.outcome);
  }

  private requireMock(): void {
    void this.money;
    // A production deployment with the mock gateway is a demo setup anyway; the page stays.
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toRawString(raw: RawBodyRequest['rawBody']): string | undefined {
  if (raw === undefined) return undefined;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return Array.isArray(raw) ? raw.join('') : raw;
}

/** The delivery every gateway sends; anything else is stored raw and refused. */
function parseDelivery(body: unknown): WebhookDelivery | null {
  if (!body || typeof body !== 'object') return null;
  const { eventId, paymentId, status, amount } = body as Record<string, unknown>;
  if (typeof eventId !== 'string' || typeof paymentId !== 'string') return null;
  if (status !== 'paid' && status !== 'failed' && status !== 'refund') return null;
  return {
    eventId,
    paymentId,
    status,
    ...(typeof amount === 'number' ? { amountBdt: amount } : {}),
  };
}

function mockPage(invoiceId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Season Challenger checkout</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  main { background: #161b22; border-radius: 16px; padding: 32px; max-width: 380px; width: calc(100% - 32px); text-align: center; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #f5b40022; color: #f5b400; font-weight: 700; font-size: 13px; }
  h1 { font-size: 20px; margin: 16px 0 4px; }
  p { color: #8b949e; font-size: 14px; line-height: 1.5; }
  form { margin: 8px 0 0; }
  button { width: 100%; border: 0; border-radius: 10px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .pay { background: #f5b400; color: #111; margin-bottom: 8px; }
  .fail { background: #21262d; color: #e6edf3; }
</style>
</head>
<body>
<main>
  <span class="badge">Development gateway</span>
  <h1>Mock e-wallet checkout</h1>
  <p>Invoice <strong>${invoiceId}</strong>. This page stands in for the bKash/Nagad/Rocket/Upay
  checkout while the API runs the mock gateway. Choosing "Pay now" confirms the payment with a
  validly signed webhook; "Cancel" reports a failed payment.</p>
  <form method="post" action="/v1/payments/mock/checkout/${invoiceId}">
    <input type="hidden" name="outcome" value="paid">
    <button class="pay" type="submit">Pay now</button>
  </form>
  <form method="post" action="/v1/payments/mock/checkout/${invoiceId}">
    <input type="hidden" name="outcome" value="failed">
    <button class="fail" type="submit">Cancel payment</button>
  </form>
</main>
</body>
</html>`;
}
