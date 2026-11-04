import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import { SYSTEM, userAccount, type LedgerStore } from '@season/wallet';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { signWebhookBody } from '../src/economy/payments/gateway';
import { LEDGER_STORE } from '../src/common/tokens';

// 2026-09-01: gameweek 4 kicks off on 5 September.
let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
let app: INestApplication;
const http = () => request(app.getHttpServer());
const as = (userId: string) => ({ 'x-user-id': userId });
const admin = { 'x-admin-token': 'dev-admin-token' };

beforeAll(async () => {
  app = await createApp({
    feed,
    clock,
    logger: false,
    money: {
      settings: {
        coinsPerBdt: 50,
        minDepositBdt: 20,
        maxDepositBdt: 25_000,
        minRedeemBdt: 1,
        coinToCashCoinsPerBdt: 60,
        minConversionBdt: 10,
        minWithdrawBdt: 500,
        maxWithdrawBdt: 10_000,
      },
      gateway: 'mock',
      paymentsSecret: 'test-webhook-secret',
      apiPublicUrl: 'http://api.test',
      invoiceValidityMinutes: 30,
    },
  });
  await app.listen(0);
});
afterAll(async () => {
  await app.close();
});

/** Credits won coins straight into a player's ledger, like a settled tournament would. */
async function seedWinnings(userId: string, coins: number) {
  const ledger = app.get<LedgerStore>(LEDGER_STORE);
  await ledger.transact(async (uow) => {
    await uow.post({
      idempotencyKey: `seed:${userId}:${coins}`,
      kind: 'contest_settlement',
      postings: [
        { account: SYSTEM.guaranteeFunding, amount: -coins },
        { account: userAccount(userId, 'winnings'), amount: coins },
      ],
    });
  });
}

async function wallet(userId: string) {
  const res = await http().get('/v1/me/wallet').set(as(userId)).expect(200);
  return res.body as { bonus: number; winnings: number; cash: number; total: number };
}

describe('money: the Game of 11 flows', () => {
  it('explains rates and limits in the economy rules', async () => {
    const res = await http().get('/v1/economy').expect(200);
    expect(res.body).toMatchObject({
      moneyIn: true,
      moneyOut: true,
      money: {
        enabled: true,
        deposit: { minBdt: 20, maxBdt: 25_000, coinsPerBdt: 50 },
        coinToCash: { coinsPerBdt: 60 },
        withdraw: {
          minBdt: 500,
          maxBdt: 10_000,
          channels: ['bkash', 'nagad', 'rocket', 'upay', 'bank'],
        },
      },
    });
  });

  it('sells coins: invoice, hosted checkout, one credit, replays change nothing', async () => {
    const before = (await wallet('dina')).bonus;
    const invoice = await http()
      .post('/v1/me/deposits')
      .set(as('dina'))
      .send({ amountBdt: 500, channel: 'bkash' })
      .expect(201);
    expect(invoice.body).toMatchObject({
      amountBdt: 500,
      coins: 25_000,
      gateway: 'mock',
      paymentId: expect.stringMatching(/^INV-/),
    });
    expect(invoice.body.paymentUrl).toContain(`/v1/payments/mock/checkout/`);
    // The mock checkout page tells the payer what this is and posts the decision. Test that
    // the POST directly, since a browser form needs the session the page pretends to be.
    const paid = await http()
      .post(`/v1/payments/mock/checkout/${invoice.body.paymentId}`)
      .send({ outcome: 'paid' })
      .expect(200);
    expect(paid.body).toMatchObject({ credited: true, coins: 25_000 });
    expect(await wallet('dina')).toMatchObject({ bonus: before + 25_000 });

    // Replaying the same checkout (or the same webhook) never credits twice.
    const replay = await http()
      .post(`/v1/payments/mock/checkout/${invoice.body.paymentId}`)
      .send({ outcome: 'paid' })
      .expect(200);
    expect(replay.body).toEqual({ received: true, credited: false, reason: 'already_paid' });
    expect((await wallet('dina')).bonus).toBe(before + 25_000);

    // A signed delivery for an invoice that does not exist changes nothing.
    const delivery = JSON.stringify({
      eventId: 'evt-stranger',
      paymentId: 'INV-XXXXXX',
      status: 'paid',
      amount: 20,
    });
    await http()
      .post('/v1/payments/webhook/mock')
      .set({ 'x-season-signature': signWebhookBody(delivery, 'test-webhook-secret') })
      .send(JSON.parse(delivery))
      .expect(200);
    expect((await wallet('dina')).bonus).toBe(before + 25_000);
  });

  it('refuses deposits outside the limits, and tampered webhooks outright', async () => {
    await http()
      .post('/v1/me/deposits')
      .set(as('dina'))
      .send({ amountBdt: 19, channel: 'nagad' })
      .expect(400);
    await http()
      .post('/v1/me/deposits')
      .set(as('dina'))
      .send({ amountBdt: 25_001, channel: 'nagad' })
      .expect(400);
    await http()
      .post('/v1/me/deposits')
      .set(as('dina'))
      .send({ amountBdt: 100, channel: 'paypal' })
      .expect(400);
    const delivery = JSON.stringify({
      eventId: 'evt-forged',
      paymentId: 'INV-FORGED',
      status: 'paid',
    });
    await http()
      .post('/v1/payments/webhook/mock')
      .set({ 'x-season-signature': signWebhookBody(delivery, 'wrong-secret') })
      .send(JSON.parse(delivery))
      .expect(400);
    // A mismatched amount against a real invoice is stored but never credited.
    const invoice = await http()
      .post('/v1/me/deposits')
      .set(as('dina'))
      .send({ amountBdt: 100, channel: 'rocket' })
      .expect(201);
    const mismatch = JSON.stringify({
      eventId: 'evt-mismatch',
      paymentId: invoice.body.paymentId,
      status: 'paid',
      amount: 999,
    });
    const res = await http()
      .post('/v1/payments/webhook/mock')
      .set({ 'x-season-signature': signWebhookBody(mismatch, 'test-webhook-secret') })
      .send(JSON.parse(mismatch))
      .expect(200);
    expect(res.body).toEqual({ received: true, credited: false, reason: 'amount_mismatch' });
    expect((await wallet('dina')).bonus).toBe(25_500); // the 500 invoice from the first test only
  });

  it('converts won coins into cash at the stricter rate, once per id', async () => {
    await seedWinnings('convertuser', 120_000);
    const w0 = await wallet('convertuser');
    expect(w0.winnings).toBe(120_000);
    const tooSmall = await http()
      .post('/v1/me/convert')
      .set(as('convertuser'))
      .send({ coins: 20, requestId: '11111111-1111-4111-8111-111111111111' })
      .expect(400);
    expect(tooSmall.body.error).toBe('invalid_amount');
    const converted = await http()
      .post('/v1/me/convert')
      .set(as('convertuser'))
      .send({ coins: 60_000, requestId: '22222222-2222-4222-8222-222222222222' })
      .expect(200);
    expect(converted.body).toMatchObject({ coins: 60_000, cashBdt: 1_000, duplicate: false });
    const again = await http()
      .post('/v1/me/convert')
      .set(as('convertuser'))
      .send({ coins: 60_000, requestId: '22222222-2222-4222-8222-222222222222' })
      .expect(200);
    expect(again.body).toMatchObject({ duplicate: true, cashBdt: 1_000 });
    const w1 = await wallet('convertuser');
    expect(w1).toMatchObject({ cash: 1_000, winnings: 60_000 });
    // More than the winnings left: refused.
    await http()
      .post('/v1/me/convert')
      .set(as('convertuser'))
      .send({ coins: 60_001, requestId: '33333333-3333-4333-8333-333333333331' })
      .expect(409);
  });

  it('redeems cash into coins at the deposit rate', async () => {
    const before = await wallet('convertuser');
    const redeemed = await http()
      .post('/v1/me/redeem')
      .set(as('convertuser'))
      .send({ amountBdt: 10, requestId: '44444444-4444-4444-8444-444444444444' })
      .expect(200);
    expect(redeemed.body).toMatchObject({ amountBdt: 10, coins: 500, duplicate: false });
    const after = await wallet('convertuser');
    expect(after.cash).toBe(before.cash - 10);
    expect(after.bonus).toBe(before.bonus + 500);
    // With no cash there is nothing to redeem.
    await http()
      .post('/v1/me/redeem')
      .set(as('dina'))
      .send({ amountBdt: 10, requestId: '55555555-5555-4555-8555-555555555555' })
      .expect(409);
  });

  it('gates cash-outs on a verified ID, the limits and a real wallet number', async () => {
    await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 600,
        channel: 'bkash',
        destination: '01712345678',
        requestId: '66666666-6666-4666-8666-666666666666',
      })
      .expect(403);
    // 600 taka of cash: verify, then the limits and the number format bite first.
    await http()
      .post('/v1/me/verification')
      .set(as('convertuser'))
      .send({ birthDate: '2000-01-31', documentNumber: '1990123456789' })
      .expect(200);
    await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 100,
        channel: 'bkash',
        destination: '01712345678',
        requestId: '77777777-7777-4777-8777-777777777777',
      })
      .expect(400);
    await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 600,
        channel: 'bkash',
        destination: 'abc',
        requestId: '88888888-8888-4888-8888-888888888888',
      })
      .expect(400);
  });

  it('holds the cash on request and shows the request with user info in the admin queue', async () => {
    const created = await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 600,
        channel: 'nagad',
        destination: '01712345678',
        requestId: '99999999-9999-4999-8999-999999999999',
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'pending', amountBdt: 600, channel: 'nagad' });
    // 1000 converted, 10 redeemed, 600 held.
    expect((await wallet('convertuser')).cash).toBe(390);
    // Same id returns the same request; the cash is not held twice.
    const same = await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 600,
        channel: 'nagad',
        destination: '01712345678',
        requestId: '99999999-9999-4999-8999-999999999999',
      })
      .expect(201);
    expect(same.body.id).toBe(created.body.id);

    await http().get('/v1/admin/withdrawals').expect(401); // no token, no queue
    const queue = await http().get('/v1/admin/withdrawals').set(admin).expect(200);
    const row = queue.body.items.find(
      (i: { id: string }) => i.id === '99999999-9999-4999-8999-999999999999',
    );
    expect(row).toMatchObject({
      amountBdt: 600,
      channel: 'nagad',
      destination: '01712345678',
      status: 'pending',
      user: { id: 'convertuser', verified: true, phone: null },
    });
  });

  it('rejecting a request flows the held cash back to the player', async () => {
    const rejected = await http()
      .post('/v1/admin/withdrawals/99999999-9999-4999-8999-999999999999/review')
      .set(admin)
      .send({
        action: 'reject',
        reason: 'Simulated: the wallet number could not be confirmed.',
        operator: 'ops-1',
      })
      .expect(201);
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      reviewReason: 'Simulated: the wallet number could not be confirmed.',
      reviewedBy: 'ops-1',
    });
    // The hold flows straight back: 390 kept + 600 released.
    expect((await wallet('convertuser')).cash).toBe(990);
  });

  it('approves, then marks paid with the e-wallet reference exactly once', async () => {
    const second = await http()
      .post('/v1/me/withdrawals')
      .set(as('convertuser'))
      .send({
        amountBdt: 500,
        channel: 'bkash',
        destination: '01812345678',
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
      .expect(201);
    const approved = await http()
      .post('/v1/admin/withdrawals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review')
      .set(admin)
      .send({ action: 'approve', operator: 'ops-1' })
      .expect(201);
    expect(approved.body).toMatchObject({ status: 'approved' });
    // Paying without the reference is refused; the reference is the audit trail.
    await http()
      .post('/v1/admin/withdrawals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review')
      .set(admin)
      .send({ action: 'paid', operator: 'ops-1' })
      .expect(409);
    const paid = await http()
      .post('/v1/admin/withdrawals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review')
      .set(admin)
      .send({ action: 'paid', payoutReference: 'TRX0001231', operator: 'ops-1' })
      .expect(201);
    expect(paid.body).toMatchObject({ status: 'paid', payoutReference: 'TRX0001231' });
    expect((await wallet('convertuser')).cash).toBe(990 - 500);
    // Nothing left to review.
    await http()
      .post('/v1/admin/withdrawals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review')
      .set(admin)
      .send({ action: 'reject', reason: 'late' })
      .expect(409);
    const history = await http().get('/v1/me/withdrawals').set(as('convertuser')).expect(200);
    const statuses = history.body.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(['paid', 'rejected']);
  });

  it('keeps the coin-only economy when the money module is off', async () => {
    const coinsOnly = await createApp({ feed, clock, logger: false });
    try {
      await coinsOnly.listen(0);
      const res = await request(coinsOnly.getHttpServer()).get('/v1/economy').expect(200);
      expect(res.body.moneyIn).toBe(false);
      await request(coinsOnly.getHttpServer())
        .post('/v1/me/deposits')
        .set(as('dina'))
        .send({ amountBdt: 100, channel: 'bkash' })
        .expect(404);
    } finally {
      await coinsOnly.close();
    }
  });
});
