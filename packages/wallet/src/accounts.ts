/**
 * Ledger accounts. Every amount is a whole number of coins, never a float.
 *
 * Coins never come from or go back to money: there is no deposit and no cash-out. Coins enter
 * the economy from system accounts (sign-up bonus, rewards, sponsored prize top-ups) and leave
 * it through sinks (the platform's share of each pool, vouchers redeemed). User and contest
 * accounts may never go negative; system accounts can, because they mint or burn coins.
 */
export type AccountId = string;

/**
 * The two balances in a user's wallet.
 * - `bonus`: the sign-up bonus, daily and Season Mastery rewards, promotions. Spent on
 *   tournament entries only; it can never be redeemed for vouchers.
 * - `winnings`: coins won in tournaments. Spent on entries or redeemed for vouchers.
 * Entries spend bonus coins first, then winnings.
 */
export type WalletBalance = 'bonus' | 'winnings';
export const WALLET_BALANCES: readonly WalletBalance[] = ['bonus', 'winnings'];

export const userAccount = (userId: string, balance: WalletBalance): AccountId =>
  `user:${userId}:${balance}`;

export const contestPool = (contestId: string): AccountId => `contest:${contestId}:pool`;

export const SYSTEM = {
  /** Mints the sign-up bonus and promotional grants. */
  promotions: 'system:promotions',
  /** Mints daily check-in and Season Mastery rewards. */
  rewards: 'system:rewards',
  /** Mints the top-up that lets a guaranteed tournament pay its full prizes. */
  guaranteeFunding: 'system:guarantee_funding',
  /** Sink: the platform's share of each settled pool. */
  platformFees: 'system:platform_fees',
  /** Sink: coins spent on vouchers (a cancelled voucher's coins come back from here). */
  vouchers: 'system:vouchers',
} as const;

export function mustStayNonNegative(account: AccountId): boolean {
  return account.startsWith('user:') || account.startsWith('contest:');
}
