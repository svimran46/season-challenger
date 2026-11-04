import { SYSTEM, cashAccount, userAccount } from './accounts';
import { WalletError } from './errors';
import type { LedgerReader, Posting, TransactionKind, TransactionDraft } from './ledger';

/**
 * The money side of the wallet: deposits, cash-to-coin redeems, coin-to-cash conversions and
 * withdrawals, with the same rules Game of 11 enforces server-side:
 *
 * - A **deposit** turns bdt paid through an e-wallet gateway into `bonus` coins. Bonus coins
 *   are entry currency only: they can enter tournaments or be redeemed for vouchers never, and
 *   they never convert back to money. (No deposit → withdraw round trip.)
 * - **Redeem** turns won cash into coins at the deposit rate. Only cash can redeem; coins are
 *   spent, the taka leaves the withdrawable side. There is no endpoint that gives this back.
 * - **Coin-to-cash** is the only bridge out: won `winnings` coins convert to cash at a worse
 *   rate than deposits, so money leaves the house only through playing. Deposited (bonus)
 *   coins keep no cash-out path, exactly as in Game of 11.
 * - A **withdrawal** reserves cash immediately (a hold posting), then an operator reviews the
 *   queue, pays it over a bKash-class e-wallet and records the payout reference, or rejects it
 *   and the hold flows back. Nothing is sent without that review.
 *
 * Every draft is a checked double-entry transaction; the caller posts it inside one unit of
 * work together with their own row writes.
 */

/** Server-set rates and limits, defaults from Game of 11's settings table. */
export interface MoneySettings {
  /** Coins one taka buys, for deposits and for cash→coin redeems. */
  coinsPerBdt: number;
  /** Fewest taka a single deposit invoices. */
  minDepositBdt: number;
  /** Most taka a single deposit invoices; Game of 11 shows no cap, so this is a safety rail. */
  maxDepositBdt: number;
  /** Fewest taka redeemable into coins. */
  minRedeemBdt: number;
  /**
   * Winnings coins needed for 1 taka when converting coins to cash. Has to stay above
   * `coinsPerBdt`, so converting cash back into coins is always cheaper than converting it
   * again into cash and cashing out the same taka twice.
   */
  coinToCashCoinsPerBdt: number;
  /** Fewest taka a single coin-to-cash conversion pays. */
  minConversionBdt: number;
  /** Withdrawal limits, per request. */
  minWithdrawBdt: number;
  maxWithdrawBdt: number;
}

export const DEFAULT_MONEY_SETTINGS: MoneySettings = {
  coinsPerBdt: 50,
  minDepositBdt: 20,
  maxDepositBdt: 25_000,
  minRedeemBdt: 1,
  coinToCashCoinsPerBdt: 60,
  minConversionBdt: 10,
  minWithdrawBdt: 500,
  maxWithdrawBdt: 10_000,
};

/** Positive whole number of taka; the ledger never carries floats or 0-amount movements. */
export function wholeBdt(amount: number, what: string): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new WalletError(
      'invalid_amount',
      `${what} must be a positive whole number, got ${amount}.`,
    );
  }
  return amount;
}

/** Coins bought for `amountBdt`, checking the amount against the deposit limits. */
export function depositCoins(amountBdt: number, settings = DEFAULT_MONEY_SETTINGS): number {
  wholeBdt(amountBdt, 'Deposit amount');
  checkSettings(settings);
  if (amountBdt < settings.minDepositBdt) {
    throw new WalletError(
      'invalid_amount',
      `The smallest deposit is ${settings.minDepositBdt} taka, not ${amountBdt}.`,
    );
  }
  if (amountBdt > settings.maxDepositBdt) {
    throw new WalletError(
      'invalid_amount',
      `One deposit is at most ${settings.maxDepositBdt} taka, not ${amountBdt}.`,
    );
  }
  return amountBdt * settings.coinsPerBdt;
}

/**
 * Guards the cross-rate invariant: coins→cash must never pay better than cash→coins, or
 * players recycle taka through the two rates and drain the balance. Run on every settings use.
 */
export function checkSettings(s: MoneySettings): MoneySettings {
  const fail = (message: string) => {
    throw new WalletError('invalid_amount', message);
  };
  if (!Number.isSafeInteger(s.coinsPerBdt) || s.coinsPerBdt < 1) fail('coinsPerBdt must be 1+.');
  if (!Number.isSafeInteger(s.maxDepositBdt) || s.maxDepositBdt < s.minDepositBdt) {
    fail('maxDepositBdt must not be below minDepositBdt.');
  }
  if (!Number.isSafeInteger(s.coinToCashCoinsPerBdt) || s.coinToCashCoinsPerBdt < 1) {
    fail('coinToCashCoinsPerBdt must be 1+.');
  }
  if (s.coinToCashCoinsPerBdt <= s.coinsPerBdt) {
    fail('Converting coins to cash must cost more coins per taka than buying coins does.');
  }
  return s;
}

/** Draft for a deposit: the platform mints `bonus` coins against the taka it received. */
export function depositDraft(
  userId: string,
  input: { invoiceId: string; amountBdt: number; settings?: MoneySettings },
): TransactionDraft {
  const settings = checkSettings(input.settings ?? DEFAULT_MONEY_SETTINGS);
  const coins = depositCoins(input.amountBdt, settings);
  return {
    idempotencyKey: `deposit:${input.invoiceId}`,
    kind: 'deposit',
    postings: [
      { account: SYSTEM.coinSales, amount: -coins },
      { account: userAccount(userId, 'bonus'), amount: coins },
    ],
    meta: {
      userId,
      invoiceId: input.invoiceId,
      amountBdt: input.amountBdt,
      coins,
      coinsPerBdt: settings.coinsPerBdt,
    },
  };
}

/** Reverses a credited deposit when the gateway reports a refund. */
export function depositRefundDraft(credit: TransactionDraft): TransactionDraft {
  if (credit.kind !== 'deposit') {
    throw new WalletError('invalid_deposit', `${credit.idempotencyKey} is not a deposit.`);
  }
  return {
    idempotencyKey: `deposit_refund:${
      typeof credit.meta?.invoiceId === 'string' ? credit.meta.invoiceId : credit.idempotencyKey
    }`,
    kind: 'deposit_refund',
    postings: credit.postings.map((p) => ({ account: p.account, amount: -p.amount })),
    meta: { ...credit.meta, refundOf: credit.idempotencyKey },
  };
}

/**
 * Draft for a redeem: cash turns into bonus coins at the deposit rate. The idempotency key is
 * the caller's `redemptionId`, so a retried request posts once.
 */
export function redeemDraft(
  reader: LedgerReader,
  input: {
    redemptionId: string;
    userId: string;
    amountBdt: number;
    settings?: MoneySettings;
  },
): { draft: TransactionDraft; coins: number } {
  const settings = checkSettings(input.settings ?? DEFAULT_MONEY_SETTINGS);
  const { amountBdt, userId } = input;
  wholeBdt(amountBdt, 'Redeem amount');
  if (amountBdt < settings.minRedeemBdt) {
    throw new WalletError(
      'invalid_amount',
      `The smallest redeem is ${settings.minRedeemBdt} taka, got ${amountBdt}.`,
    );
  }
  const coins = amountBdt * settings.coinsPerBdt;
  const cash = reader.balance(cashAccount(userId));
  if (cash < amountBdt) {
    throw new WalletError(
      'insufficient_cash',
      `Cash balance ${cash} cannot redeem ${amountBdt} taka.`,
    );
  }
  return {
    coins,
    draft: {
      idempotencyKey: `redeem:${input.redemptionId}`,
      kind: 'redeem',
      postings: [
        { account: cashAccount(userId), amount: -amountBdt },
        { account: SYSTEM.redeemedCash, amount: amountBdt },
        { account: SYSTEM.coinSales, amount: -coins },
        { account: userAccount(userId, 'bonus'), amount: coins },
      ],
      meta: {
        userId,
        redemptionId: input.redemptionId,
        amountBdt,
        coins,
        coinsPerBdt: settings.coinsPerBdt,
      },
    },
  };
}

/**
 * Draft for a coin-to-cash conversion: `coins` of own winnings turn into whole taka at the
 * stricter rate, floored - leftover coins stay winnings. Bonus coins (rewards and bought
 * coins) are refused: played winnings are the only coins that ever become money.
 */
export function coinToCashDraft(
  reader: LedgerReader,
  input: {
    conversionId: string;
    userId: string;
    coins: number;
    settings?: MoneySettings;
  },
): { draft: TransactionDraft; cashBdt: number } {
  const settings = checkSettings(input.settings ?? DEFAULT_MONEY_SETTINGS);
  const { coins, userId } = input;
  if (!Number.isSafeInteger(coins) || coins <= 0) {
    throw new WalletError(
      'invalid_amount',
      `Conversion amount must be a whole number, got ${coins}.`,
    );
  }
  const cashBdt = Math.floor(coins / settings.coinToCashCoinsPerBdt);
  if (cashBdt < settings.minConversionBdt) {
    throw new WalletError(
      'invalid_amount',
      `${coins} coins convert to ${cashBdt} taka; the smallest conversion pays ${settings.minConversionBdt}.`,
    );
  }
  const winnings = reader.balance(userAccount(userId, 'winnings'));
  if (winnings < coins) {
    throw new WalletError(
      'insufficient_winnings',
      `Won coins usable for conversion: ${winnings}, needs ${coins}.`,
    );
  }
  return {
    cashBdt,
    draft: {
      idempotencyKey: `coin_to_cash:${input.conversionId}`,
      kind: 'coin_to_cash',
      postings: [
        { account: userAccount(userId, 'winnings'), amount: -coins },
        { account: SYSTEM.convertedCoins, amount: coins },
        { account: SYSTEM.cashFunding, amount: -cashBdt },
        { account: cashAccount(userId), amount: cashBdt },
      ],
      meta: {
        userId,
        conversionId: input.conversionId,
        coins,
        cashBdt,
        coinsPerBdt: settings.coinToCashCoinsPerBdt,
      },
    },
  };
}

// --------------------------------------------------------------------------- withdrawals

/** Where a cash-out can be sent. GO11 shipped bKash; the other e-wallets asked to be here. */
export type PayoutChannel = 'bkash' | 'nagad' | 'rocket' | 'upay' | 'bank';
export const PAYOUT_CHANNELS: readonly PayoutChannel[] = [
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'bank',
];
/** Channels that take a wallet number rather than a bank account. */
export const WALLET_CHANNELS: readonly PayoutChannel[] = ['bkash', 'nagad', 'rocket', 'upay'];

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'failed';

export interface WithdrawalSpec {
  requestId: string;
  userId: string;
  amountBdt: number;
  channel: PayoutChannel;
  destination: string;
}

/** A personal e-wallet number: 11 digits, an 01-prefixed operator code (e.g. 01712345678). */
const WALLET_NUMBER = /^01[3-9]\d{8}$/;
/** A bank account number: 6 to 24 digits, possibly with dashes or spaces. */
const BANK_ACCOUNT = /^\d{6}[\d- ]{0,18}\d$/;

/** The destination for a channel, or an explainer for the player when it is wrong. */
export function destinationError(channel: PayoutChannel, destination: string): string | null {
  if (destination.length > 40) return 'Keep the account number under 40 characters.';
  if (WALLET_CHANNELS.includes(channel)) {
    return WALLET_NUMBER.test(destination)
      ? null
      : 'Enter your 11-digit e-wallet number, like 01712345678.';
  }
  return BANK_ACCOUNT.test(destination) ? null : 'Enter your bank account number, 6 to 24 digits.';
}

/** Validates amount, channel and destination for a cash-out request. */
export function validateWithdrawal(
  input: Omit<WithdrawalSpec, 'userId' | 'requestId'>,
  settings = DEFAULT_MONEY_SETTINGS,
): void {
  checkSettings(settings);
  wholeBdt(input.amountBdt, 'Withdrawal amount');
  if (input.amountBdt < settings.minWithdrawBdt) {
    throw new WalletError(
      'invalid_amount',
      `The smallest cash-out is ${settings.minWithdrawBdt} taka, not ${input.amountBdt}.`,
    );
  }
  if (input.amountBdt > settings.maxWithdrawBdt) {
    throw new WalletError(
      'invalid_amount',
      `One cash-out is at most ${settings.maxWithdrawBdt} taka, not ${input.amountBdt}.`,
    );
  }
  if (!PAYOUT_CHANNELS.includes(input.channel)) {
    throw new WalletError(
      'invalid_payout',
      `Choose one of ${PAYOUT_CHANNELS.join(', ')}, not "${input.channel}".`,
    );
  }
  const bad = destinationError(input.channel, input.destination);
  if (bad) throw new WalletError('invalid_payout', bad);
}

/**
 * Reserves the cash the moment the request is made: the player's balance drops and the taka
 * waits in the pending account until an approve/reject decision moves it. Nothing is paid out
 * without the operator review that follows.
 */
export function withdrawHoldDraft(
  reader: LedgerReader,
  input: WithdrawalSpec,
  settings = DEFAULT_MONEY_SETTINGS,
): TransactionDraft {
  validateWithdrawal(input, settings);
  const cash = reader.balance(cashAccount(input.userId));
  if (cash < input.amountBdt) {
    throw new WalletError(
      'insufficient_cash',
      `Cash balance ${cash} is short of the ${input.amountBdt} taka cash-out.`,
    );
  }
  return {
    idempotencyKey: `withdraw_hold:${input.requestId}`,
    kind: 'withdraw_hold',
    postings: [
      { account: cashAccount(input.userId), amount: -input.amountBdt },
      { account: SYSTEM.withdrawPending, amount: input.amountBdt },
    ],
    meta: {
      userId: input.userId,
      requestId: input.requestId,
      amountBdt: input.amountBdt,
      channel: input.channel,
      destination: input.destination,
    },
  };
}

/** Puts a held cash-out back on the player's balance: the request was rejected or could not pay. */
export function withdrawReleaseDraft(
  input: Pick<WithdrawalSpec, 'requestId' | 'userId' | 'amountBdt'> & { reason?: string },
): TransactionDraft {
  wholeBdt(input.amountBdt, 'Release amount');
  const postings: Posting[] = [
    { account: SYSTEM.withdrawPending, amount: -input.amountBdt },
    { account: cashAccount(input.userId), amount: input.amountBdt },
  ];
  return {
    idempotencyKey: `withdraw_release:${input.requestId}`,
    kind: 'withdraw_release',
    postings,
    meta: {
      userId: input.userId,
      requestId: input.requestId,
      amountBdt: input.amountBdt,
      reason: input.reason ?? '',
    },
  };
}

/** Books the held taka as paid out: it left through the e-wallet, recorded with the reference. */
export function withdrawPaidDraft(
  input: Pick<WithdrawalSpec, 'requestId' | 'userId' | 'amountBdt'> & { payoutReference: string },
): TransactionDraft {
  wholeBdt(input.amountBdt, 'Paid amount');
  if (!input.payoutReference) {
    throw new WalletError(
      'invalid_payout',
      'Record the e-wallet or bank reference of the payment.',
    );
  }
  return {
    idempotencyKey: `withdraw_paid:${input.requestId}`,
    kind: 'withdraw_paid',
    postings: [
      { account: SYSTEM.withdrawPending, amount: -input.amountBdt },
      { account: SYSTEM.withdrawals, amount: input.amountBdt },
    ],
    meta: {
      userId: input.userId,
      requestId: input.requestId,
      amountBdt: input.amountBdt,
      payoutReference: input.payoutReference,
    },
  };
}

export type MoneyKind = Extract<
  TransactionKind,
  | 'deposit'
  | 'deposit_refund'
  | 'redeem'
  | 'coin_to_cash'
  | 'withdraw_hold'
  | 'withdraw_release'
  | 'withdraw_paid'
>;

/** True when the transaction moves taka rather than coins, so activity feeds can split them. */
export const isMoneyKind = (kind: TransactionKind): boolean =>
  kind === 'deposit' ||
  kind === 'deposit_refund' ||
  kind === 'redeem' ||
  kind === 'coin_to_cash' ||
  kind.startsWith('withdraw_');
