/**
 * Ledger accounts. Every amount is a whole number, never a float: coins for balances named
 * `bonus`/`winnings`, whole taka (BDT) for `cash`.
 *
 * Money owes its own rules: bought coins (`bonus`) can enter tournaments but never come back
 * out as money; only won coins (converted to `user:<id>:cash`) can be withdrawn. Coins enter
 * the economy from system accounts (deposits, sign-up bonus, rewards, sponsored top-ups) and
 * leave it through sinks (the platform's share of each pool, vouchers redeemed, withdrawals
 * paid). User and contest accounts may never go negative; system accounts can, because they
 * mint or burn coins and taka.
 */
export type AccountId = string;

/**
 * The two coin balances in a user's wallet.
 * - `bonus`: the sign-up bonus, daily and Season Mastery rewards, promotions and bought
 *   coins (deposits). Spent on tournament entries; it can never be redeemed for vouchers or
 *   converted to cash.
 * - `winnings`: coins won in tournaments. Spent on entries, redeemed for vouchers or
 *   converted to cash.
 * Entries spend bonus coins first, then winnings.
 */
export type WalletBalance = 'bonus' | 'winnings';
export const WALLET_BALANCES: readonly WalletBalance[] = ['bonus', 'winnings'];

export const userAccount = (userId: string, balance: WalletBalance): AccountId =>
  `user:${userId}:${balance}`;

/** The user's cash balance, a whole number of taka. Withdrawals are paid out of it. */
export const cashAccount = (userId: string): AccountId => `user:${userId}:cash`;

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
  /** Offsets the mint of bought coins: deposits and cash-to-coin redeems. */
  coinSales: 'system:coin_sales',
  /** Sink: taka the player spent converting their cash back into coins. */
  redeemedCash: 'system:redeemed_cash',
  /** Sink: won coins that were converted to cash. */
  convertedCoins: 'system:converted_coins',
  /** Mints the taka paid out when won coins convert to cash. */
  cashFunding: 'system:cash_funding',
  /** Staging: cash reserved by open withdrawal requests, paid or released later. */
  withdrawPending: 'system:withdraw_pending',
  /** Sink: taka actually sent to a player over an e-wallet. */
  withdrawals: 'system:withdrawals',
} as const;

export function mustStayNonNegative(account: AccountId): boolean {
  return account.startsWith('user:') || account.startsWith('contest:');
}
