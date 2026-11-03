export type WalletErrorCode =
  // ledger rules
  | 'unbalanced'
  | 'invalid_amount'
  | 'empty'
  | 'negative_balance'
  | 'idempotency_conflict'
  // tournaments
  | 'insufficient_funds'
  | 'contest_full'
  | 'invalid_contest'
  // rewards
  | 'invalid_reward'
  // vouchers
  | 'invalid_offer'
  | 'offer_unavailable'
  | 'out_of_stock'
  | 'not_verified'
  | 'under_age'
  | 'redemptions_blocked'
  | 'limit_reached'
  | 'insufficient_winnings'
  | 'voucher_not_usable';

/** Every rule the wallet enforces fails with one of these, so the API can map codes to replies. */
export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}
