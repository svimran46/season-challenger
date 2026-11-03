import { describe, expect, it } from 'vitest';
import {
  contestEntry,
  contestPool,
  contestSettlement,
  contestSetup,
  dailyCheckIn,
  entryRefund,
  InMemoryLedger,
  masteryCardReward,
  nextDate,
  redemptionBlocker,
  signUpBonus,
  SYSTEM,
  voucherRedemption,
  walletOf,
  WalletError,
  type ContestFormat,
  type Transaction,
  type VoucherOffer,
} from '../src';

describe('a month of the coin economy', () => {
  it('conserves every coin and only ever redeems won coins', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const ledger = new InMemoryLedger();
    const users = Array.from({ length: 60 }, (_, i) => `u${i}`);
    for (const u of users) ledger.post(signUpBonus(u));

    const offer: VoucherOffer = {
      id: 'o1',
      partnerId: 'p1',
      partnerName: 'Demo Travel',
      category: 'travel',
      title: '10% off a bus ticket',
      terms: 'Intercity routes.',
      costCoins: 150,
      discount: { kind: 'percent', percent: 10, maxDiscountBdt: 300, minSpendBdt: 0 },
      validForDays: 60,
      stock: null,
      perUserMonthlyLimit: 3,
      availableFrom: '2026-01-01T00:00:00Z',
      availableUntil: null,
      active: true,
    };
    const redeemed = new Map<string, number>();
    let winningsPaid = 0;
    let vouchersIssued = 0;

    let day = '2026-11-01';
    for (let d = 0; d < 30; d += 1, day = nextDate(day)) {
      const now = new Date(`${day}T12:00:00Z`);
      for (const u of users) {
        if (rand() < 0.7) ledger.post(dailyCheckIn(u, day, 1 + (d % 9)));
        if (rand() < 0.3) ledger.post(masteryCardReward(u, `card-${day}`));
      }

      for (let c = 0; c < 6; c += 1) {
        const format: ContestFormat = (['head_to_head', 'small_league', 'mega'] as const)[c % 3]!;
        const terms = contestSetup({
          id: `${day}-${c}`,
          format,
          entryFee: [25, 50, 10][c % 3]!,
          capacity: format === 'mega' ? 50 : undefined,
          minEntries: format === 'mega' ? 10 : undefined,
        });
        const entries: Transaction[] = [];
        for (const userId of users) {
          if (entries.length >= terms.capacity || rand() > 0.4) continue;
          try {
            entries.push(
              ledger.post(
                contestEntry(ledger, terms, {
                  entryId: `${terms.id}:${userId}`,
                  userId,
                  currentEntries: entries.length,
                }),
              ),
            );
          } catch (e) {
            expect((e as WalletError).code).toBe('insufficient_funds');
          }
        }
        if (entries.length >= terms.minEntries) {
          const results = entries.map((t) => ({
            entryId: String(t.meta?.entryId),
            userId: String(t.meta?.userId),
            points: Math.floor(rand() * 120),
          }));
          const settlement = contestSettlement(ledger, terms, results);
          ledger.post(settlement.draft);
          winningsPaid += settlement.payouts.reduce((sum, p) => sum + p.prize, 0);
        } else {
          for (const t of entries) ledger.post(entryRefund(t));
        }
        expect(ledger.balance(contestPool(terms.id))).toBe(0);
      }

      for (const u of users) {
        const count = redeemed.get(u) ?? 0;
        const usage = {
          coinsThisMonth: count * offer.costCoins,
          vouchersThisMonth: count,
          thisOfferThisMonth: count,
        };
        const redeemer = {
          userId: u,
          idVerifiedAt: '2026-10-01T00:00:00Z',
          birthDate: '1995-01-01',
          redemptionsBlocked: false,
        };
        if (redemptionBlocker(ledger, { offer, redeemer, usage, now })) continue;
        ledger.post(
          voucherRedemption(ledger, {
            redemptionId: `${u}:${day}`,
            code: 'x',
            offer,
            redeemer,
            usage,
            now,
          }).draft,
        );
        redeemed.set(u, count + 1);
        vouchersIssued += 1;
      }
    }

    expect(ledger.trialBalance()).toBe(0);
    const minted =
      -ledger.balance(SYSTEM.promotions) -
      ledger.balance(SYSTEM.rewards) -
      ledger.balance(SYSTEM.guaranteeFunding);
    const held = users.reduce((sum, u) => sum + walletOf(ledger, u).total, 0);
    expect(held + ledger.balance(SYSTEM.platformFees) + ledger.balance(SYSTEM.vouchers)).toBe(
      minted,
    );
    expect(vouchersIssued).toBeGreaterThan(0);
    expect(ledger.balance(SYSTEM.vouchers)).toBe(vouchersIssued * offer.costCoins);
    // Vouchers can only have been bought with coins won in tournaments.
    expect(ledger.balance(SYSTEM.vouchers)).toBeLessThanOrEqual(winningsPaid);
    for (const u of users) {
      expect(redeemed.get(u) ?? 0).toBeLessThanOrEqual(3);
      const w = walletOf(ledger, u);
      expect(Math.min(w.bonus, w.winnings)).toBeGreaterThanOrEqual(0);
    }
  });
});
