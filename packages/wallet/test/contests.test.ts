import { describe, expect, it } from 'vitest';
import {
  buildPrizeTable,
  contestEntry,
  contestPool,
  contestSettlement,
  entryRefund,
  InMemoryLedger,
  promotion,
  signUpBonus,
  SYSTEM,
  totalPrizes,
  userAccount,
  validateContest,
  walletOf,
  WalletError,
  type ContestTerms,
} from '../src';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

function contest(overrides: Partial<ContestTerms> = {}): ContestTerms {
  const entryFee = overrides.entryFee ?? 100;
  const capacity = overrides.capacity ?? 4;
  return {
    id: 'c1',
    entryFee,
    capacity,
    minEntries: capacity,
    guaranteed: false,
    prizeTable: buildPrizeTable({ kind: 'top_three' }, entryFee, capacity, 1500),
    maxBonusShareBps: 10_000,
    ...overrides,
  };
}

/** Free bonus coins, e.g. from a promotion. */
function fund(ledger: InMemoryLedger, userId: string, coins: number) {
  ledger.post(promotion(userId, `test-${coins}`, coins));
}

/** Won coins, as if from an earlier tournament with a sponsored prize. */
function giveWinnings(ledger: InMemoryLedger, userId: string, coins: number) {
  ledger.post({
    idempotencyKey: `test-winnings:${userId}:${coins}`,
    kind: 'contest_settlement',
    postings: [
      { account: SYSTEM.guaranteeFunding, amount: -coins },
      { account: userAccount(userId, 'winnings'), amount: coins },
    ],
  });
}

describe('wallet', () => {
  it('gives each user one 500-coin sign-up bonus', () => {
    const ledger = new InMemoryLedger();
    ledger.post(signUpBonus('u1'));
    ledger.post(signUpBonus('u1'));
    expect(walletOf(ledger, 'u1')).toEqual({ bonus: 500, winnings: 0, total: 500, redeemable: 0 });
  });
});

describe('buildPrizeTable', () => {
  it('pays exactly the pool minus the platform fee', () => {
    for (const [shape, fee, capacity] of [
      [{ kind: 'winner_takes_all' }, 50, 2],
      [{ kind: 'top_three' }, 100, 10],
      [{ kind: 'top_share', paidShareBps: 2500 }, 25, 1000],
      [{ kind: 'top_share', paidShareBps: 3000 }, 7, 13],
    ] as const) {
      const table = buildPrizeTable(shape, fee, capacity, 1500);
      expect(totalPrizes(table)).toBe(Math.floor((fee * capacity * 8500) / 10_000));
      validateContest(
        contest({ entryFee: fee, capacity, minEntries: capacity, prizeTable: table }),
      );
    }
  });

  it('gives every paid rank in a big tournament at least its entry fee back', () => {
    const table = buildPrizeTable({ kind: 'top_share', paidShareBps: 2500 }, 25, 1000, 1500);
    expect(table.at(-1)).toMatchObject({ toRank: 250 });
    expect(Math.min(...table.map((t) => t.amount))).toBeGreaterThanOrEqual(25);
  });
});

describe('validateContest', () => {
  it('rejects broken terms', () => {
    expect(
      code(() =>
        validateContest(contest({ prizeTable: [{ fromRank: 2, toRank: 2, amount: 10 }] })),
      ),
    ).toBe('invalid_contest');
    expect(
      code(() =>
        validateContest(
          contest({
            prizeTable: [
              { fromRank: 1, toRank: 1, amount: 10 },
              { fromRank: 2, toRank: 2, amount: 20 },
            ],
          }),
        ),
      ),
    ).toBe('invalid_contest');
    expect(
      code(() =>
        validateContest(contest({ prizeTable: [{ fromRank: 1, toRank: 1, amount: 401 }] })),
      ),
    ).toBe('invalid_contest');
    expect(code(() => validateContest(contest({ minEntries: 2 })))).toBe('invalid_contest');
  });
});

describe('contestEntry', () => {
  it('lets a new player pay the whole fee from the sign-up bonus', () => {
    const ledger = new InMemoryLedger();
    ledger.post(signUpBonus('u1'));
    ledger.post(
      contestEntry(ledger, contest(), { entryId: 'e1', userId: 'u1', currentEntries: 0 }),
    );
    expect(walletOf(ledger, 'u1')).toMatchObject({ bonus: 400, winnings: 0 });
    expect(ledger.balance(contestPool('c1'))).toBe(100);
  });

  it('spends bonus up to its share, then winnings', () => {
    const ledger = new InMemoryLedger();
    ledger.post(signUpBonus('u1'));
    giveWinnings(ledger, 'u1', 100);
    const terms = contest({ maxBonusShareBps: 1000 });
    ledger.post(contestEntry(ledger, terms, { entryId: 'e1', userId: 'u1', currentEntries: 0 }));
    expect(walletOf(ledger, 'u1')).toEqual({
      bonus: 490,
      winnings: 10,
      total: 500,
      redeemable: 10,
    });
  });

  it('refuses an entry the wallet cannot cover, or a full contest', () => {
    const ledger = new InMemoryLedger();
    fund(ledger, 'u1', 60);
    expect(
      code(() =>
        contestEntry(ledger, contest(), { entryId: 'e1', userId: 'u1', currentEntries: 0 }),
      ),
    ).toBe('insufficient_funds');
    // Only 10% of the fee may come from bonus coins here, and u1 has no winnings.
    ledger.post(signUpBonus('u1'));
    expect(
      code(() =>
        contestEntry(ledger, contest({ maxBonusShareBps: 1000 }), {
          entryId: 'e1',
          userId: 'u1',
          currentEntries: 0,
        }),
      ),
    ).toBe('insufficient_funds');
    expect(
      code(() =>
        contestEntry(ledger, contest(), { entryId: 'e1', userId: 'u1', currentEntries: 4 }),
      ),
    ).toBe('contest_full');
  });

  it('refunds to the exact balances the fee came from, once', () => {
    const ledger = new InMemoryLedger();
    ledger.post(signUpBonus('u1'));
    giveWinnings(ledger, 'u1', 200);
    const entry = ledger.post(
      contestEntry(ledger, contest({ maxBonusShareBps: 1000 }), {
        entryId: 'e1',
        userId: 'u1',
        currentEntries: 0,
      }),
    );
    expect(walletOf(ledger, 'u1')).toMatchObject({ bonus: 490, winnings: 110 });
    ledger.post(entryRefund(entry));
    ledger.post(entryRefund(entry));
    expect(walletOf(ledger, 'u1')).toEqual({
      bonus: 500,
      winnings: 200,
      total: 700,
      redeemable: 200,
    });
    expect(ledger.balance(contestPool('c1'))).toBe(0);
  });
});

describe('contestSettlement', () => {
  function fullContest(points: number[], terms = contest()) {
    const ledger = new InMemoryLedger();
    const results = points.map((p, i) => {
      const userId = `u${i + 1}`;
      fund(ledger, userId, terms.entryFee);
      ledger.post(contestEntry(ledger, terms, { entryId: `e${i + 1}`, userId, currentEntries: i }));
      return { entryId: `e${i + 1}`, userId, points: p };
    });
    return { ledger, results, terms };
  }

  it('pays the prize table, keeps the fee, and empties the pool', () => {
    const { ledger, results, terms } = fullContest([80, 120, 60, 100]);
    const { draft, payouts, platformFee } = contestSettlement(ledger, terms, results);
    ledger.post(draft);
    // Pool 400, 15% fee: prizes 170 / 102 / 68.
    expect(payouts.map((p) => [p.userId, p.rank, p.prize])).toEqual([
      ['u2', 1, 170],
      ['u4', 2, 102],
      ['u1', 3, 68],
      ['u3', 4, 0],
    ]);
    expect(platformFee).toBe(60);
    expect(ledger.balance(contestPool('c1'))).toBe(0);
    expect(ledger.balance(SYSTEM.platformFees)).toBe(60);
    expect(ledger.trialBalance()).toBe(0);
  });

  it('splits tied ranks equally and hands out leftover coins', () => {
    const { ledger, results, terms } = fullContest([90, 90, 90, 10]);
    const { draft, payouts } = contestSettlement(ledger, terms, results);
    ledger.post(draft);
    // Ranks 1-3 tie: (170 + 102 + 68) / 3 = 113 rem 1.
    expect(payouts.map((p) => p.prize)).toEqual([114, 113, 113, 0]);
    expect(walletOf(ledger, 'u1').winnings).toBe(114);
  });

  it('settles once even if the job runs twice', () => {
    const { ledger, results, terms } = fullContest([1, 2, 3, 4]);
    const first = ledger.post(contestSettlement(ledger, terms, results).draft);
    const rerun = contestSettlement(ledger, terms, results);
    expect(ledger.post(rerun.draft)).toBe(first);
    expect(rerun.platformFee).toBe(60);
    expect(walletOf(ledger, 'u4').winnings).toBe(170);
    expect(ledger.all().filter((t) => t.kind === 'contest_settlement')).toHaveLength(1);
  });

  it('tops up a guaranteed contest that did not fill', () => {
    const terms = contest({ guaranteed: true, minEntries: 2 });
    const { ledger, results } = fullContest([5, 9], terms);
    const { draft, guaranteeTopUp, platformFee } = contestSettlement(ledger, terms, results);
    ledger.post(draft);
    // Pool 200 covers 170 + 102 = 272 only with a 72-coin top-up.
    expect(guaranteeTopUp).toBe(72);
    expect(platformFee).toBe(0);
    expect(ledger.balance(SYSTEM.guaranteeFunding)).toBe(-72);
    expect(ledger.trialBalance()).toBe(0);
  });

  it('refuses to settle a contest below its minimum entries', () => {
    const terms = contest();
    const { ledger, results } = fullContest([5, 9, 3], { ...terms, capacity: 4 });
    expect(code(() => contestSettlement(ledger, terms, results))).toBe('invalid_contest');
  });
});

describe('a simulated season', () => {
  it('never creates or loses a coin', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const ledger = new InMemoryLedger();
    const users = Array.from({ length: 30 }, (_, i) => `u${i}`);
    for (const u of users) {
      ledger.post(signUpBonus(u));
      fund(ledger, u, 100 + Math.floor(rand() * 900));
    }

    for (let c = 0; c < 40; c += 1) {
      const capacity = 2 + Math.floor(rand() * 8);
      const terms = contest({
        id: `c${c}`,
        entryFee: 10 + Math.floor(rand() * 90),
        capacity,
        minEntries: capacity,
        prizeTable: [],
        maxBonusShareBps: rand() < 0.5 ? 10_000 : 5_000,
      });
      terms.prizeTable = buildPrizeTable(
        { kind: 'top_share', paidShareBps: 4000 },
        terms.entryFee,
        capacity,
      );
      const entrants = users.filter(() => rand() < 0.5).slice(0, capacity);
      const entries = [];
      for (const [i, userId] of entrants.entries()) {
        try {
          entries.push(
            ledger.post(
              contestEntry(ledger, terms, {
                entryId: `c${c}-${userId}`,
                userId,
                currentEntries: i,
              }),
            ),
          );
        } catch (e) {
          expect((e as WalletError).code).toBe('insufficient_funds');
        }
      }
      if (entries.length === capacity) {
        const results = entries.map((t) => ({
          entryId: String(t.meta?.entryId),
          userId: String(t.meta?.userId),
          points: Math.floor(rand() * 100),
        }));
        ledger.post(contestSettlement(ledger, terms, results).draft);
      } else {
        for (const t of entries) ledger.post(entryRefund(t));
      }
      expect(ledger.balance(contestPool(terms.id))).toBe(0);
    }

    expect(ledger.trialBalance()).toBe(0);
    for (const u of users) {
      const w = walletOf(ledger, u);
      expect(Math.min(w.bonus, w.winnings)).toBeGreaterThanOrEqual(0);
    }
    const minted = -ledger.balance(SYSTEM.promotions);
    const held = users.reduce((sum, u) => sum + walletOf(ledger, u).total, 0);
    expect(held + ledger.balance(SYSTEM.platformFees)).toBe(minted);
    expect(ledger.recomputedBalances().get(SYSTEM.platformFees)).toBe(
      ledger.balance(SYSTEM.platformFees),
    );
  });
});
