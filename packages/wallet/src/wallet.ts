import { SYSTEM, userAccount, WALLET_BALANCES, type WalletBalance } from './accounts';
import { WalletError } from './errors';
import type { LedgerReader, TransactionDraft } from './ledger';
import { isCalendarDate, nextDate } from './time';

/** Every new account gets this many bonus coins, once. */
export const SIGN_UP_BONUS = 500;

/** Free coin rewards. All of them land in the bonus balance, which is entry-only. */
export interface RewardSettings {
  /** Coins for opening the app once a day. */
  dailyCheckIn: number;
  /** Extra coins on every 7th day in a row. */
  weeklyStreakBonus: number;
  /** Coins for submitting a Season Mastery analysis card before kick-off. */
  masteryCard: number;
}

export const DEFAULT_REWARDS: RewardSettings = {
  dailyCheckIn: 20,
  weeklyStreakBonus: 50,
  masteryCard: 15,
};

export type Wallet = Record<WalletBalance, number> & {
  total: number;
  /** Coins that can be redeemed for vouchers: winnings only. */
  redeemable: number;
};

export function walletOf(reader: LedgerReader, userId: string): Wallet {
  const wallet = { bonus: 0, winnings: 0, total: 0, redeemable: 0 };
  for (const b of WALLET_BALANCES) {
    wallet[b] = reader.balance(userAccount(userId, b));
    wallet.total += wallet[b];
  }
  wallet.redeemable = wallet.winnings;
  return wallet;
}

function positive(amount: number, what: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new WalletError(
      'invalid_amount',
      `${what} must be a positive whole number, got ${amount}.`,
    );
  }
}

const mint = (from: string, userId: string, amount: number) => [
  { account: from, amount: -amount },
  { account: userAccount(userId, 'bonus'), amount },
];

/** One sign-up bonus per user, ever: the idempotency key is the user id. */
export function signUpBonus(userId: string, amount = SIGN_UP_BONUS): TransactionDraft {
  positive(amount, 'Sign-up bonus');
  return {
    idempotencyKey: `sign_up_bonus:${userId}`,
    kind: 'sign_up_bonus',
    postings: mint(SYSTEM.promotions, userId, amount),
    meta: { userId },
  };
}

/** A promotion grant, at most once per user per campaign. */
export function promotion(userId: string, campaignId: string, amount: number): TransactionDraft {
  positive(amount, 'Promotion');
  return {
    idempotencyKey: `promotion:${campaignId}:${userId}`,
    kind: 'promotion',
    postings: mint(SYSTEM.promotions, userId, amount),
    meta: { userId, campaignId },
  };
}

/**
 * The streak after checking in on `today`, given the last check-in date: it grows by one on
 * consecutive days and restarts at 1 after a missed day. Checking in twice on one day keeps it.
 */
export function nextStreak(
  last: { date: string; streak: number } | null,
  today: string,
): { streak: number; alreadyCheckedIn: boolean } {
  if (!isCalendarDate(today)) throw new WalletError('invalid_reward', `Bad date ${today}.`);
  if (!last) return { streak: 1, alreadyCheckedIn: false };
  if (last.date === today) return { streak: last.streak, alreadyCheckedIn: true };
  if (nextDate(last.date) === today) return { streak: last.streak + 1, alreadyCheckedIn: false };
  if (last.date > today) {
    throw new WalletError('invalid_reward', `Check-in for ${today} is before ${last.date}.`);
  }
  return { streak: 1, alreadyCheckedIn: false };
}

export function dailyCheckInAmount(streak: number, settings = DEFAULT_REWARDS): number {
  return settings.dailyCheckIn + (streak > 0 && streak % 7 === 0 ? settings.weeklyStreakBonus : 0);
}

/** The daily check-in reward, at most once per user per Dhaka calendar day. */
export function dailyCheckIn(
  userId: string,
  localDate: string,
  streak: number,
  settings = DEFAULT_REWARDS,
): TransactionDraft {
  if (!isCalendarDate(localDate)) {
    throw new WalletError('invalid_reward', `Check-in date ${localDate} is not YYYY-MM-DD.`);
  }
  if (!Number.isSafeInteger(streak) || streak < 1) {
    throw new WalletError('invalid_reward', `Streak must be 1 or more, got ${streak}.`);
  }
  const amount = dailyCheckInAmount(streak, settings);
  positive(amount, 'Daily reward');
  return {
    idempotencyKey: `reward:daily:${userId}:${localDate}`,
    kind: 'reward',
    postings: mint(SYSTEM.rewards, userId, amount),
    meta: { userId, reward: 'daily_check_in', date: localDate, streak },
  };
}

/** The reward for submitting a Season Mastery card, once per card. */
export function masteryCardReward(
  userId: string,
  cardId: string,
  amount = DEFAULT_REWARDS.masteryCard,
): TransactionDraft {
  positive(amount, 'Mastery reward');
  return {
    idempotencyKey: `reward:mastery:${cardId}:${userId}`,
    kind: 'reward',
    postings: mint(SYSTEM.rewards, userId, amount),
    meta: { userId, reward: 'mastery_card', cardId },
  };
}
