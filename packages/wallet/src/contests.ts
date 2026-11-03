import { rankEntries } from '@season/shared';
import { contestPool, SYSTEM, userAccount } from './accounts';
import { WalletError } from './errors';
import type { LedgerReader, Posting, Transaction, TransactionDraft } from './ledger';

/** Every rank from `fromRank` to `toRank` (inclusive) wins `amount`. */
export interface PrizeTier {
  fromRank: number;
  toRank: number;
  amount: number;
}

export interface ContestTerms {
  id: string;
  entryFee: number;
  capacity: number;
  /** Fewest entries for the contest to run. Below this it is cancelled and refunded. */
  minEntries: number;
  /** A guaranteed contest pays its full prize table even if it does not fill. */
  guaranteed: boolean;
  prizeTable: PrizeTier[];
  /**
   * Share of each entry fee that may come from bonus coins, in basis points (10000 = all of
   * it). New players only hold bonus coins, so the default lets them pay the whole fee.
   */
  maxBonusShareBps: number;
}

export type PrizeShape =
  | { kind: 'winner_takes_all' }
  | { kind: 'top_three' }
  /** Pays the top share of entries, each paid rank at least the entry fee back. */
  | { kind: 'top_share'; paidShareBps: number };

/** The platform's share of each pool. Coins only, so this is a sink that keeps coins scarce. */
export const DEFAULT_PLATFORM_FEE_BPS = 1500;
export const DEFAULT_MAX_BONUS_SHARE_BPS = 10_000;

/** Builds a prize table whose total is exactly the full pool minus the platform fee. */
export function buildPrizeTable(
  shape: PrizeShape,
  entryFee: number,
  capacity: number,
  platformFeeBps = DEFAULT_PLATFORM_FEE_BPS,
): PrizeTier[] {
  const pool = entryFee * capacity;
  const net = Math.floor((pool * (10_000 - platformFeeBps)) / 10_000);
  let perRank: number[];

  switch (shape.kind) {
    case 'winner_takes_all':
      perRank = [net];
      break;
    case 'top_three': {
      const weights = [50, 30, 20].slice(0, Math.min(3, capacity));
      const sum = weights.reduce((a, b) => a + b, 0);
      perRank = weights.map((w) => Math.floor((net * w) / sum));
      break;
    }
    case 'top_share': {
      const paid = Math.max(1, Math.floor((capacity * shape.paidShareBps) / 10_000));
      const floor = paid * entryFee <= net ? entryFee : 0;
      const spare = net - floor * paid;
      const weights = Array.from({ length: paid }, (_, i) => 1 / (i + 1));
      const sum = weights.reduce((a, b) => a + b, 0);
      perRank = weights.map((w) => floor + Math.floor((spare * w) / sum));
      break;
    }
  }

  // Rounding leftovers go to first place, so the table always pays out exactly `net`.
  const leftover = net - perRank.reduce((a, b) => a + b, 0);
  perRank[0] = (perRank[0] ?? 0) + leftover;

  const tiers: PrizeTier[] = [];
  perRank.forEach((amount, i) => {
    const rank = i + 1;
    const last = tiers.at(-1);
    if (last && last.amount === amount) last.toRank = rank;
    else tiers.push({ fromRank: rank, toRank: rank, amount });
  });
  return tiers;
}

export function prizeForRank(table: readonly PrizeTier[], rank: number): number {
  return table.find((t) => rank >= t.fromRank && rank <= t.toRank)?.amount ?? 0;
}

export function totalPrizes(table: readonly PrizeTier[]): number {
  return table.reduce((sum, t) => sum + t.amount * (t.toRank - t.fromRank + 1), 0);
}

export function validateContest(terms: ContestTerms): void {
  const fail = (message: string) => {
    throw new WalletError('invalid_contest', `Contest ${terms.id}: ${message}`);
  };
  if (!Number.isSafeInteger(terms.entryFee) || terms.entryFee <= 0)
    fail('entry fee must be a positive whole number.');
  if (!Number.isSafeInteger(terms.capacity) || terms.capacity < 2)
    fail('capacity must be at least 2.');
  if (terms.minEntries < 2 || terms.minEntries > terms.capacity)
    fail('minEntries must be 2 to capacity.');
  if (!terms.guaranteed && terms.minEntries !== terms.capacity) {
    fail('a contest that is not guaranteed only runs when full.');
  }
  if (terms.maxBonusShareBps < 0 || terms.maxBonusShareBps > 10_000)
    fail('bonus share must be 0 to 10000 bps.');

  let expected = 1;
  let previous = Number.POSITIVE_INFINITY;
  for (const tier of terms.prizeTable) {
    if (tier.fromRank !== expected || tier.toRank < tier.fromRank)
      fail('prize ranks must run 1, 2, 3... with no gaps.');
    if (!Number.isSafeInteger(tier.amount) || tier.amount <= 0)
      fail('prizes must be positive whole numbers.');
    if (tier.amount > previous) fail('a lower rank cannot win more than a higher one.');
    previous = tier.amount;
    expected = tier.toRank + 1;
  }
  if (terms.prizeTable.length === 0) fail('the prize table is empty.');
  if (expected - 1 > terms.capacity)
    fail('the prize table pays more ranks than the contest holds.');
  if (totalPrizes(terms.prizeTable) > terms.entryFee * terms.capacity) {
    fail('prizes exceed the full pool.');
  }
}

/**
 * Debits the entry fee into the contest pool: bonus coins first (up to the bonus share), then
 * winnings. `currentEntries` comes from the caller, which must hold a lock on the contest row
 * so two joins cannot both take the last seat.
 */
export function contestEntry(
  reader: LedgerReader,
  terms: ContestTerms,
  entry: { entryId: string; userId: string; currentEntries: number },
): TransactionDraft {
  if (entry.currentEntries >= terms.capacity) {
    throw new WalletError('contest_full', `Contest ${terms.id} is full.`);
  }
  const fee = terms.entryFee;
  const bonus = reader.balance(userAccount(entry.userId, 'bonus'));
  const winnings = reader.balance(userAccount(entry.userId, 'winnings'));
  const fromBonus = Math.min(bonus, Math.floor((fee * terms.maxBonusShareBps) / 10_000));
  const fromWinnings = fee - fromBonus;
  if (fromWinnings > winnings) {
    throw new WalletError(
      'insufficient_funds',
      `User ${entry.userId} needs ${fee} coins to enter; usable balance is ${fromBonus + winnings}.`,
    );
  }

  const postings: Posting[] = [
    { account: userAccount(entry.userId, 'bonus'), amount: -fromBonus },
    { account: userAccount(entry.userId, 'winnings'), amount: -fromWinnings },
    { account: contestPool(terms.id), amount: fee },
  ];
  return {
    idempotencyKey: `entry:${entry.entryId}`,
    kind: 'contest_entry',
    postings,
    meta: { contestId: terms.id, entryId: entry.entryId, userId: entry.userId },
  };
}

/** Returns an entry fee to exactly the balances it came from. */
export function entryRefund(entry: Transaction): TransactionDraft {
  if (entry.kind !== 'contest_entry') {
    throw new WalletError('invalid_contest', `Transaction ${entry.id} is not a contest entry.`);
  }
  return {
    idempotencyKey: `refund:${entry.meta?.entryId ?? entry.id}`,
    kind: 'entry_refund',
    postings: entry.postings.map((p) => ({ account: p.account, amount: -p.amount })),
    meta: { ...entry.meta, refundOf: entry.id },
  };
}

export interface ContestResult {
  entryId: string;
  userId: string;
  points: number;
}

export interface Payout extends ContestResult {
  rank: number;
  prize: number;
}

/**
 * Pays out a finished contest from its pool. Tied entries share the prizes of every rank they
 * occupy equally; leftover coins from the split go one each to the tied entries in entry id
 * order, so every prize coin reaches a player. The platform keeps what is left in the pool;
 * a guaranteed contest that did not fill is topped up from guarantee funding.
 */
export function contestSettlement(
  reader: LedgerReader,
  terms: ContestTerms,
  results: readonly ContestResult[],
): { draft: TransactionDraft; payouts: Payout[]; platformFee: number; guaranteeTopUp: number } {
  validateContest(terms);
  if (results.length < terms.minEntries) {
    throw new WalletError(
      'invalid_contest',
      `Contest ${terms.id} has ${results.length} entries, below its minimum of ${terms.minEntries}; refund it instead.`,
    );
  }

  const ranked = rankEntries(results);
  const payouts: Payout[] = [];
  for (let i = 0; i < ranked.length;) {
    const rank = ranked[i]!.rank;
    const group = ranked
      .filter((r) => r.rank === rank)
      .sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
    let total = 0;
    for (let pos = rank; pos < rank + group.length; pos += 1)
      total += prizeForRank(terms.prizeTable, pos);
    const share = Math.floor(total / group.length);
    let leftover = total - share * group.length;
    for (const r of group) {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      payouts.push({
        entryId: r.entryId,
        userId: r.userId,
        points: r.points,
        rank,
        prize: share + extra,
      });
    }
    i += group.length;
  }

  // A rerun after settlement returns the transaction already posted, so the job is safe to repeat.
  const settled = reader.findByKey(`settle:${terms.id}`);
  if (settled) {
    const amountOn = (account: string) =>
      settled.postings.find((p) => p.account === account)?.amount ?? 0;
    return {
      draft: settled,
      payouts,
      platformFee: amountOn(SYSTEM.platformFees),
      guaranteeTopUp: -amountOn(SYSTEM.guaranteeFunding),
    };
  }

  const pool = reader.balance(contestPool(terms.id));
  const paid = payouts.reduce((sum, p) => sum + p.prize, 0);
  const guaranteeTopUp = Math.max(0, paid - pool);
  if (guaranteeTopUp > 0 && !terms.guaranteed) {
    throw new WalletError(
      'invalid_contest',
      `Contest ${terms.id} pool ${pool} cannot cover prizes ${paid}.`,
    );
  }
  const platformFee = Math.max(0, pool - paid);

  const postings: Posting[] = [
    { account: contestPool(terms.id), amount: -pool },
    { account: SYSTEM.platformFees, amount: platformFee },
    { account: SYSTEM.guaranteeFunding, amount: -guaranteeTopUp },
    ...payouts.map((p) => ({ account: userAccount(p.userId, 'winnings'), amount: p.prize })),
  ];
  return {
    draft: {
      idempotencyKey: `settle:${terms.id}`,
      kind: 'contest_settlement',
      postings,
      meta: { contestId: terms.id, entries: results.length },
    },
    payouts,
    platformFee,
    guaranteeTopUp,
  };
}
