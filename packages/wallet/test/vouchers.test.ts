import { describe, expect, it } from 'vitest';
import {
  checkVoucherUse,
  describeDiscount,
  generateVoucherCode,
  InMemoryLedger,
  redemptionBlocker,
  signUpBonus,
  SYSTEM,
  userAccount,
  validateOffer,
  voucherRedemption,
  voucherRefund,
  voucherStatus,
  walletOf,
  WalletError,
  type Redeemer,
  type VoucherOffer,
} from '../src';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

const NOW = new Date('2026-11-03T10:00:00Z');

const offer = (overrides: Partial<VoucherOffer> = {}): VoucherOffer => ({
  id: 'o1',
  partnerId: 'p1',
  partnerName: 'Demo Café',
  category: 'shop',
  title: '20% off your bill',
  terms: 'Dine-in only.',
  costCoins: 300,
  discount: { kind: 'percent', percent: 20, maxDiscountBdt: 500, minSpendBdt: 1000 },
  validForDays: 30,
  stock: 10,
  perUserMonthlyLimit: 2,
  availableFrom: '2026-11-01T00:00:00Z',
  availableUntil: '2026-12-31T00:00:00Z',
  active: true,
  ...overrides,
});

const verified: Redeemer = {
  userId: 'u1',
  idVerifiedAt: '2026-11-02T09:00:00Z',
  birthDate: '1998-05-10',
  redemptionsBlocked: false,
};
const noUsage = { coinsThisMonth: 0, vouchersThisMonth: 0, thisOfferThisMonth: 0 };

function withWinnings(coins: number) {
  const ledger = new InMemoryLedger();
  ledger.post(signUpBonus('u1'));
  ledger.post({
    idempotencyKey: 'won',
    kind: 'contest_settlement',
    postings: [
      { account: SYSTEM.guaranteeFunding, amount: -coins },
      { account: userAccount('u1', 'winnings'), amount: coins },
    ],
  });
  return ledger;
}

describe('validateOffer', () => {
  it('accepts shop and travel discounts', () => {
    validateOffer(offer());
    validateOffer(
      offer({
        category: 'travel',
        discount: { kind: 'amount', amountBdt: 1_000, minSpendBdt: 5_000 },
        validForDays: 90,
      }),
    );
  });

  it('refuses anything that works like cash', () => {
    const bad: Partial<VoucherOffer>[] = [
      { discount: { kind: 'percent', percent: 100, maxDiscountBdt: 500, minSpendBdt: 0 } },
      { discount: { kind: 'percent', percent: 51, maxDiscountBdt: 500, minSpendBdt: 0 } },
      { discount: { kind: 'percent', percent: 20, maxDiscountBdt: 0, minSpendBdt: 0 } },
      { discount: { kind: 'amount', amountBdt: 500, minSpendBdt: 0 } },
      { discount: { kind: 'amount', amountBdt: 500, minSpendBdt: 999 } },
      { validForDays: 365 },
      { costCoins: 0 },
      { stock: -1 },
      { availableUntil: '2026-10-01T00:00:00Z' },
    ];
    for (const o of bad) expect(code(() => validateOffer(offer(o)))).toBe('invalid_offer');
  });

  it('describes discounts in taka', () => {
    expect(describeDiscount(offer().discount)).toBe('20% off, up to ৳500, on ৳1,000 or more');
    expect(describeDiscount({ kind: 'amount', amountBdt: 1500, minSpendBdt: 6000 })).toBe(
      '৳1,500 off on ৳6,000 or more',
    );
  });
});

describe('voucherRedemption', () => {
  it('spends won coins only and issues a voucher bound to the account', () => {
    const ledger = withWinnings(400);
    const { draft, voucher } = voucherRedemption(ledger, {
      redemptionId: 'r1',
      code: 'SC-AAAA-BBBB',
      offer: offer(),
      redeemer: verified,
      usage: noUsage,
      now: NOW,
    });
    ledger.post(draft);
    expect(walletOf(ledger, 'u1')).toEqual({
      bonus: 500,
      winnings: 100,
      total: 600,
      redeemable: 100,
    });
    expect(ledger.balance(SYSTEM.vouchers)).toBe(300);
    expect(voucher).toMatchObject({
      userId: 'u1',
      partnerId: 'p1',
      expiresAt: '2026-12-03T10:00:00.000Z',
    });
    expect(ledger.trialBalance()).toBe(0);
  });

  it('never lets bonus coins buy a voucher', () => {
    const ledger = withWinnings(299);
    expect(
      code(() =>
        voucherRedemption(ledger, {
          redemptionId: 'r1',
          code: 'x',
          offer: offer(),
          redeemer: verified,
          usage: noUsage,
          now: NOW,
        }),
      ),
    ).toBe('insufficient_winnings');
  });

  it('requires a verified adult, stock, an open offer and room under the limits', () => {
    const ledger = withWinnings(10_000);
    const blocker = (o: Partial<VoucherOffer>, r: Partial<Redeemer>, usage = noUsage, now = NOW) =>
      redemptionBlocker(ledger, { offer: offer(o), redeemer: { ...verified, ...r }, usage, now })
        ?.code;
    expect(blocker({}, {})).toBeUndefined();
    expect(blocker({ active: false }, {})).toBe('offer_unavailable');
    expect(blocker({}, {}, noUsage, new Date('2026-12-31T00:00:00Z'))).toBe('offer_unavailable');
    expect(blocker({ stock: 0 }, {})).toBe('out_of_stock');
    expect(blocker({}, { idVerifiedAt: null })).toBe('not_verified');
    expect(blocker({}, { birthDate: '2008-11-04' })).toBe('under_age');
    expect(blocker({}, { birthDate: '2008-11-03' })).toBeUndefined();
    expect(blocker({}, { redemptionsBlocked: true })).toBe('redemptions_blocked');
    expect(blocker({}, {}, { ...noUsage, thisOfferThisMonth: 2 })).toBe('limit_reached');
    expect(blocker({}, {}, { ...noUsage, vouchersThisMonth: 5 })).toBe('limit_reached');
    expect(blocker({}, {}, { ...noUsage, coinsThisMonth: 4_800 })).toBe('limit_reached');
  });

  it('returns the coins when a voucher is cancelled, once', () => {
    const ledger = withWinnings(400);
    const txn = ledger.post(
      voucherRedemption(ledger, {
        redemptionId: 'r1',
        code: 'x',
        offer: offer(),
        redeemer: verified,
        usage: noUsage,
        now: NOW,
      }).draft,
    );
    ledger.post(voucherRefund(txn));
    ledger.post(voucherRefund(txn));
    expect(walletOf(ledger, 'u1').winnings).toBe(400);
    expect(ledger.balance(SYSTEM.vouchers)).toBe(0);
  });

  it('treats a retried request as the same redemption', () => {
    const ledger = withWinnings(300);
    const input = {
      redemptionId: 'r1',
      code: 'x',
      offer: offer(),
      redeemer: verified,
      usage: noUsage,
      now: NOW,
    };
    const first = ledger.post(voucherRedemption(ledger, input).draft);
    // Winnings are now 0, but the retry must not fail or charge again.
    expect(ledger.post(voucherRedemption(ledger, input).draft)).toBe(first);
    expect(walletOf(ledger, 'u1').winnings).toBe(0);
  });
});

describe('voucher use at the partner', () => {
  const issued = {
    partnerId: 'p1',
    expiresAt: '2026-12-03T10:00:00Z',
    usedAt: null,
    cancelledAt: null,
  };

  it('can be accepted once, by the issuing partner, before it expires', () => {
    expect(voucherStatus(issued, NOW)).toBe('active');
    checkVoucherUse(issued, 'p1', NOW);
    expect(code(() => checkVoucherUse(issued, 'p2', NOW))).toBe('voucher_not_usable');
    expect(
      code(() => checkVoucherUse({ ...issued, usedAt: '2026-11-04T00:00:00Z' }, 'p1', NOW)),
    ).toBe('voucher_not_usable');
    expect(voucherStatus(issued, new Date('2026-12-03T10:00:00Z'))).toBe('expired');
    expect(voucherStatus({ ...issued, cancelledAt: '2026-11-05T00:00:00Z' }, NOW)).toBe(
      'cancelled',
    );
  });

  it('generates readable, unbiased codes', () => {
    const codes = new Set(Array.from({ length: 2_000 }, () => generateVoucherCode()));
    expect(codes.size).toBe(2_000);
    for (const c of codes) expect(c).toMatch(/^SC-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    let n = 0;
    const fixed = generateVoucherCode((b) => b.map(() => (n++ % 2 ? 255 : 0)));
    expect(fixed).toBe('SC-2222-2222');
  });
});
