import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONEY_SETTINGS,
  InMemoryLedger,
  SYSTEM,
  WalletError,
  cashAccount,
  checkSettings,
  coinToCashDraft,
  depositCoins,
  depositDraft,
  depositRefundDraft,
  destinationError,
  redeemDraft,
  userAccount,
  validateWithdrawal,
  withdrawHoldDraft,
  withdrawPaidDraft,
  withdrawReleaseDraft,
} from '../src';

const seedWinnings = (ledger: InMemoryLedger, userId: string, winnings: number, cash = 0) => {
  ledger.post({
    idempotencyKey: `seed:${userId}:${winnings}:${cash}`,
    kind: 'promotion',
    postings: [
      { account: SYSTEM.promotions, amount: -(winnings + cash) },
      { account: userAccount(userId, 'winnings'), amount: winnings },
      { account: cashAccount(userId), amount: cash },
    ],
  });
};

describe('money settings', () => {
  it('keeps converting coins to cash no better than buying coins', () => {
    expect(() => checkSettings({ ...DEFAULT_MONEY_SETTINGS, coinToCashCoinsPerBdt: 40 })).toThrow(
      /more coins per taka/,
    );
    expect(checkSettings(DEFAULT_MONEY_SETTINGS).coinToCashCoinsPerBdt).toBeGreaterThan(
      DEFAULT_MONEY_SETTINGS.coinsPerBdt,
    );
  });
});

describe('deposit', () => {
  it('turns taka into 50 coins per taka within the limits', () => {
    expect(depositCoins(20)).toBe(1_000);
    expect(depositCoins(500)).toBe(25_000);
    expect(() => depositCoins(19)).toThrow(/smallest deposit is 20/);
    expect(() => depositCoins(0)).toThrow(WalletError);
    expect(() => depositCoins(10.5)).toThrow(WalletError);
    expect(() => depositCoins(25_001)).toThrow(/at most 25000/);
  });

  it('drafts a deposit that mints bonus coins and carries the rate for audit', () => {
    const draft = depositDraft('alice', { invoiceId: 'inv-1', amountBdt: 100 });
    expect(draft.idempotencyKey).toBe('deposit:inv-1');
    expect(draft.kind).toBe('deposit');
    expect(draft.postings).toEqual([
      { account: SYSTEM.coinSales, amount: -5_000 },
      { account: userAccount('alice', 'bonus'), amount: 5_000 },
    ]);
    expect(draft.postings.reduce((s, p) => s + p.amount, 0)).toBe(0);
    expect(depositDraft('alice', { invoiceId: 'inv-1', amountBdt: 100 }).idempotencyKey).toBe(
      'deposit:inv-1',
    );
  });

  it('reverses a credited deposit when the gateway reports a refund', () => {
    const credit = depositDraft('alice', { invoiceId: 'inv-1', amountBdt: 100 });
    const refund = depositRefundDraft(credit);
    expect(refund.kind).toBe('deposit_refund');
    expect(refund.idempotencyKey).toBe('deposit_refund:inv-1');
    expect(refund.postings).toEqual(credit.postings.map((p) => ({ ...p, amount: -p.amount })));
    expect(() => depositRefundDraft({ ...credit, kind: 'reward' })).toThrow(/not a deposit/);
  });
});

describe('redeem cash to coins', () => {
  it('refuses amounts below the minimum or beyond the cash held', () => {
    const ledger = new InMemoryLedger();
    seedWinnings(ledger, 'alice', 0, 20);
    expect(() =>
      redeemDraft(ledger, { redemptionId: 'r0', userId: 'alice', amountBdt: 0 }),
    ).toThrow(WalletError);
    const { coins } = redeemDraft(ledger, {
      redemptionId: 'r1',
      userId: 'alice',
      amountBdt: 10,
    });
    expect(coins).toBe(500);
    expect(() =>
      redeemDraft(ledger, { redemptionId: 'r2', userId: 'alice', amountBdt: 21 }),
    ).toThrow(/cannot redeem 21/);
  });

  it('spends cash and mints bonus coins, each side against its own system account', () => {
    const ledger = new InMemoryLedger();
    seedWinnings(ledger, 'alice', 10_000, 100);
    const { draft } = redeemDraft(ledger, {
      redemptionId: 'r1',
      userId: 'alice',
      amountBdt: 40,
    });
    expect(draft.postings.reduce((s, p) => s + p.amount, 0)).toBe(0);
    const posted = ledger.post(draft);
    expect(posted.meta?.amountBdt).toBe(40);
    expect(posted.meta?.coinsPerBdt).toBe(50);
    expect(ledger.balance(cashAccount('alice'))).toBe(60);
    // Redeeming always refills bonus coins, the entry-only balance.
    expect(ledger.balance(userAccount('alice', 'bonus'))).toBe(2_000);
  });
});

describe('coins to cash', () => {
  it('pays floored taka at the stricter rate and keeps the rest as winnings', () => {
    const ledger = new InMemoryLedger();
    seedWinnings(ledger, 'alice', 2_000);
    expect(() =>
      coinToCashDraft(ledger, { conversionId: 'c-tiny', userId: 'alice', coins: 599 }),
    ).toThrow(/smallest conversion pays 10/);
    const result = coinToCashDraft(ledger, { conversionId: 'c1', userId: 'alice', coins: 600 });
    expect(result.cashBdt).toBe(10);
    ledger.post(result.draft);
    expect(ledger.balance(cashAccount('alice'))).toBe(10);
    expect(ledger.balance(userAccount('alice', 'winnings'))).toBe(1_400);
    expect(ledger.trialBalance()).toBe(0);
  });

  it('never converts bonus coins, only winnings', () => {
    const ledger = new InMemoryLedger();
    ledger.post(depositDraft('alice', { invoiceId: 'inv-1', amountBdt: 100 }));
    expect(ledger.balance(userAccount('alice', 'bonus'))).toBe(5_000);
    expect(() =>
      coinToCashDraft(ledger, { conversionId: 'c2', userId: 'alice', coins: 1_200 }),
    ).toThrow(/usable for conversion: 0/);
  });
});

describe('withdrawals', () => {
  it('validates amount, channel and destination', () => {
    expect(() =>
      validateWithdrawal({ amountBdt: 499, channel: 'bkash', destination: '01712345678' }),
    ).toThrow(/smallest cash-out is 500/);
    expect(() =>
      validateWithdrawal({ amountBdt: 10_001, channel: 'bkash', destination: '01712345678' }),
    ).toThrow(/at most 10000/);
    expect(() =>
      validateWithdrawal({ amountBdt: 500, channel: 'paypal' as never, destination: 'x' }),
    ).toThrow(/bkash, nagad, rocket, upay, bank/);
    expect(() =>
      validateWithdrawal({ amountBdt: 500, channel: 'bkash', destination: '12345' }),
    ).toThrow(/11-digit/);
    expect(destinationError('bkash', '01191234567')).toMatch(/11-digit/);
    expect(destinationError('bkash', '01712345678')).toBeNull();
    expect(destinationError('bank', '017123456')).toBeNull();
    expect(destinationError('bank', 'abc')).toMatch(/bank account/);
    expect(() =>
      validateWithdrawal({ amountBdt: 500.5, channel: 'bkash', destination: '01712345678' }),
    ).toThrow(/positive whole/);
  });

  it('holds the cash at request time and refuses amounts beyond the balance', () => {
    const ledger = new InMemoryLedger();
    seedWinnings(ledger, 'alice', 0, 1_100);
    expect(() =>
      withdrawHoldDraft(ledger, {
        requestId: 'w0',
        userId: 'alice',
        amountBdt: 1_101,
        channel: 'bkash',
        destination: '01712345678',
      }),
    ).toThrow(/short of the 1101/);
    const posted = ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w1',
        userId: 'alice',
        amountBdt: 600,
        channel: 'nagad',
        destination: '01712345678',
      }),
    );
    expect(posted.kind).toBe('withdraw_hold');
    // A second request can only use what the first one has not parked.
    expect(() =>
      withdrawHoldDraft(ledger, {
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 600,
        channel: 'nagad',
        destination: '01712345678',
      }),
    ).toThrow(/short of the 600/);
    ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 500,
        channel: 'nagad',
        destination: '01712345678',
      }),
    );
    expect(ledger.balance(cashAccount('alice'))).toBe(0);
    expect(ledger.balance(SYSTEM.withdrawPending)).toBe(1_100);
  });

  it('releases the hold on rejection and books paid-out taka with a reference', () => {
    const ledger = new InMemoryLedger();
    seedWinnings(ledger, 'alice', 0, 2_000);
    ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w1',
        userId: 'alice',
        amountBdt: 1_000,
        channel: 'bkash',
        destination: '01712345678',
      }),
    );
    const rejected = ledger.post(
      withdrawReleaseDraft({
        requestId: 'w1',
        userId: 'alice',
        amountBdt: 1_000,
        reason: 'wrong number',
      }),
    );
    expect(rejected.kind).toBe('withdraw_release');
    expect(ledger.balance(cashAccount('alice'))).toBe(2_000);
    expect(ledger.balance(SYSTEM.withdrawPending)).toBe(0);

    ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 1_000,
        channel: 'upay',
        destination: '01712345678',
      }),
    );
    expect(() =>
      withdrawPaidDraft({
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 1_000,
        payoutReference: '',
      }),
    ).toThrow(/reference/);
    const paid = ledger.post(
      withdrawPaidDraft({
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 1_000,
        payoutReference: 'TRX0091',
      }),
    );
    expect(paid.kind).toBe('withdraw_paid');
    expect(ledger.balance(cashAccount('alice'))).toBe(1_000);
    expect(ledger.balance(SYSTEM.withdrawPending)).toBe(0);
    expect(ledger.balance(SYSTEM.withdrawals)).toBe(1_000);
    expect(ledger.trialBalance()).toBe(0);
  });
});

describe('money ledger round trip', () => {
  it('deposit, convert, redeem, cash out: every posting balances to zero', () => {
    const ledger = new InMemoryLedger();
    ledger.post(depositDraft('alice', { invoiceId: 'inv-1', amountBdt: 500 }));
    seedWinnings(ledger, 'alice', 400_000);
    const convert = coinToCashDraft(ledger, {
      conversionId: 'c1',
      userId: 'alice',
      coins: 240_000,
    });
    expect(convert.cashBdt).toBe(4_000);
    ledger.post(convert.draft);
    const redeem = redeemDraft(ledger, { redemptionId: 'r1', userId: 'alice', amountBdt: 20 });
    expect(redeem.coins).toBe(1_000);
    ledger.post(redeem.draft);
    expect(ledger.balance(cashAccount('alice'))).toBe(3_980);

    ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w1',
        userId: 'alice',
        amountBdt: 600,
        channel: 'rocket',
        destination: '01712345678',
      }),
    );
    ledger.post(
      withdrawPaidDraft({
        requestId: 'w1',
        userId: 'alice',
        amountBdt: 600,
        payoutReference: 'RX1',
      }),
    );
    ledger.post(
      withdrawHoldDraft(ledger, {
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 800,
        channel: 'bank',
        destination: '017123456',
      }),
    );
    ledger.post(
      withdrawReleaseDraft({
        requestId: 'w2',
        userId: 'alice',
        amountBdt: 800,
        reason: 'stale KYC',
      }),
    );
    expect(ledger.balance(cashAccount('alice'))).toBe(3_380);
    expect(ledger.balance(SYSTEM.withdrawPending)).toBe(0);
    expect(ledger.balance(SYSTEM.withdrawals)).toBe(600);
    expect(ledger.trialBalance()).toBe(0);
  });
});
