import { SYSTEM, userAccount } from './accounts';
import { WalletError } from './errors';
import type { LedgerReader, Transaction, TransactionDraft } from './ledger';
import { ageOn, dhakaDate } from './time';

/**
 * Vouchers are the only thing won coins can be exchanged for. A voucher is a discount at a
 * partner shop or travel company, bound to the account that redeemed it. It is never cash,
 * never stored value, never transferable, and coins are never paid back out as money.
 */
export type VoucherCategory = 'shop' | 'travel';
export const VOUCHER_CATEGORIES: readonly VoucherCategory[] = ['shop', 'travel'];

/** Discount values are in BDT because that is what the partner takes off the bill. */
export type VoucherDiscount =
  | { kind: 'percent'; percent: number; maxDiscountBdt: number; minSpendBdt: number }
  | { kind: 'amount'; amountBdt: number; minSpendBdt: number };

export interface VoucherOffer {
  id: string;
  partnerId: string;
  partnerName: string;
  category: VoucherCategory;
  title: string;
  /** The partner's conditions, shown in full before redeeming. */
  terms: string;
  costCoins: number;
  discount: VoucherDiscount;
  /** Days the voucher stays usable after it is issued. */
  validForDays: number;
  /** Vouchers left to issue; null when the partner set no cap. */
  stock: number | null;
  /** How many of this offer one user may redeem per calendar month. */
  perUserMonthlyLimit: number;
  availableFrom: string;
  availableUntil: string | null;
  active: boolean;
}

/**
 * Guardrails that keep a voucher a discount rather than a cash equivalent: the user always
 * pays the partner something themselves, and nothing can be sold back or passed on.
 */
export const VOUCHER_RULES = {
  maxPercent: 50,
  /** A fixed-amount voucher needs a minimum spend of at least this multiple of its value. */
  minSpendMultiple: 2,
  maxValidForDays: 180,
  minimumAge: 18,
} as const;

export interface RedemptionLimits {
  /** Coins a user may spend on vouchers per Dhaka calendar month. */
  monthlyCoins: number;
  /** Vouchers a user may redeem per Dhaka calendar month. */
  monthlyVouchers: number;
}

export const DEFAULT_REDEMPTION_LIMITS: RedemptionLimits = {
  monthlyCoins: 5_000,
  monthlyVouchers: 5,
};

const whole = (n: number) => Number.isSafeInteger(n);

/** Rejects an offer that breaks the voucher guardrails. Run when a partner offer is saved. */
export function validateOffer(offer: VoucherOffer): void {
  const fail = (message: string) => {
    throw new WalletError('invalid_offer', `Offer ${offer.id}: ${message}`);
  };
  if (!VOUCHER_CATEGORIES.includes(offer.category)) fail(`unknown category ${offer.category}.`);
  if (!whole(offer.costCoins) || offer.costCoins <= 0)
    fail('cost must be a positive whole number.');
  if (!whole(offer.validForDays) || offer.validForDays < 1)
    fail('validity must be at least 1 day.');
  if (offer.validForDays > VOUCHER_RULES.maxValidForDays) {
    fail(`validity cannot exceed ${VOUCHER_RULES.maxValidForDays} days.`);
  }
  if (offer.stock !== null && (!whole(offer.stock) || offer.stock < 0))
    fail('stock must be 0 or more.');
  if (!whole(offer.perUserMonthlyLimit) || offer.perUserMonthlyLimit < 1) {
    fail('per-user monthly limit must be at least 1.');
  }
  if (Number.isNaN(Date.parse(offer.availableFrom))) fail('availableFrom is not a date.');
  if (
    offer.availableUntil !== null &&
    !(Date.parse(offer.availableUntil) > Date.parse(offer.availableFrom))
  ) {
    fail('availableUntil must be after availableFrom.');
  }

  const d = offer.discount;
  if (d.kind === 'percent') {
    if (!whole(d.percent) || d.percent < 1 || d.percent > VOUCHER_RULES.maxPercent) {
      fail(`a percentage discount must be 1 to ${VOUCHER_RULES.maxPercent}%.`);
    }
    if (!whole(d.maxDiscountBdt) || d.maxDiscountBdt <= 0)
      fail('a percentage discount needs a cap.');
    if (!whole(d.minSpendBdt) || d.minSpendBdt < 0) fail('minimum spend must be 0 or more.');
  } else if (d.kind === 'amount') {
    if (!whole(d.amountBdt) || d.amountBdt <= 0)
      fail('the discount must be a positive whole amount.');
    if (!whole(d.minSpendBdt) || d.minSpendBdt < d.amountBdt * VOUCHER_RULES.minSpendMultiple) {
      fail(`minimum spend must be at least ${VOUCHER_RULES.minSpendMultiple}x the discount.`);
    }
  } else {
    fail('unknown discount kind.');
  }
}

/** What the user sees on the voucher card, e.g. "20% off, up to ৳500, on ৳1,000 or more". */
export function describeDiscount(d: VoucherDiscount): string {
  const bdt = (n: number) => `৳${n.toLocaleString('en-US')}`;
  const spend = d.minSpendBdt > 0 ? `on ${bdt(d.minSpendBdt)} or more` : '';
  return d.kind === 'percent'
    ? `${d.percent}% off, up to ${bdt(d.maxDiscountBdt)}${spend ? `, ${spend}` : ''}`
    : `${bdt(d.amountBdt)} off ${spend}`.trim();
}

export interface Redeemer {
  userId: string;
  /** When the national ID or passport check passed; null until it does. */
  idVerifiedAt: string | null;
  /** Date of birth from the verified document, YYYY-MM-DD. */
  birthDate: string | null;
  /** Set while an account is under review, e.g. suspected multi-accounting. */
  redemptionsBlocked: boolean;
}

/** What the user has already redeemed this Dhaka calendar month. */
export interface RedemptionUsage {
  coinsThisMonth: number;
  vouchersThisMonth: number;
  thisOfferThisMonth: number;
}

export interface IssuedVoucher {
  id: string;
  code: string;
  userId: string;
  offerId: string;
  partnerId: string;
  partnerName: string;
  category: VoucherCategory;
  title: string;
  discount: VoucherDiscount;
  costCoins: number;
  issuedAt: string;
  expiresAt: string;
}

export interface RedemptionInput {
  redemptionId: string;
  code: string;
  offer: VoucherOffer;
  redeemer: Redeemer;
  usage: RedemptionUsage;
  now: Date;
  limits?: RedemptionLimits;
}

/** Why a user cannot redeem an offer right now, or null if they can. Checked in this order. */
export function redemptionBlocker(
  reader: LedgerReader,
  input: Omit<RedemptionInput, 'redemptionId' | 'code'>,
): WalletError | null {
  const { offer, redeemer, usage, now } = input;
  const limits = input.limits ?? DEFAULT_REDEMPTION_LIMITS;
  const t = now.getTime();
  const until = offer.availableUntil === null ? Infinity : Date.parse(offer.availableUntil);
  if (!offer.active || t < Date.parse(offer.availableFrom) || t >= until) {
    return new WalletError('offer_unavailable', `Offer ${offer.id} is not available.`);
  }
  if (offer.stock !== null && offer.stock <= 0) {
    return new WalletError('out_of_stock', `Offer ${offer.id} has run out.`);
  }
  if (redeemer.redemptionsBlocked) {
    return new WalletError('redemptions_blocked', 'Redemptions are paused on this account.');
  }
  if (!redeemer.idVerifiedAt || !redeemer.birthDate) {
    return new WalletError('not_verified', 'Verify your ID before redeeming a voucher.');
  }
  if (ageOn(redeemer.birthDate, dhakaDate(now)) < VOUCHER_RULES.minimumAge) {
    return new WalletError(
      'under_age',
      `Vouchers are for players aged ${VOUCHER_RULES.minimumAge}+.`,
    );
  }
  if (usage.thisOfferThisMonth >= offer.perUserMonthlyLimit) {
    return new WalletError(
      'limit_reached',
      `You can redeem this offer ${offer.perUserMonthlyLimit} time(s) a month.`,
    );
  }
  if (usage.vouchersThisMonth >= limits.monthlyVouchers) {
    return new WalletError(
      'limit_reached',
      `You can redeem ${limits.monthlyVouchers} vouchers a month.`,
    );
  }
  if (usage.coinsThisMonth + offer.costCoins > limits.monthlyCoins) {
    return new WalletError(
      'limit_reached',
      `You can redeem up to ${limits.monthlyCoins} coins a month.`,
    );
  }
  const winnings = reader.balance(userAccount(redeemer.userId, 'winnings'));
  if (winnings < offer.costCoins) {
    return new WalletError(
      'insufficient_winnings',
      `This voucher costs ${offer.costCoins} won coins; you have ${winnings}. Bonus coins cannot be redeemed.`,
    );
  }
  return null;
}

/**
 * Spends won coins on a voucher. The caller decrements the offer's stock in the same database
 * transaction, under a row lock, so the last voucher cannot be issued twice.
 */
export function voucherRedemption(
  reader: LedgerReader,
  input: RedemptionInput,
): { draft: TransactionDraft; voucher: IssuedVoucher } {
  validateOffer(input.offer);
  const { offer, redeemer, now } = input;
  // A retried request returns the voucher already issued instead of failing on limits.
  const existing = reader.findByKey(`voucher:${input.redemptionId}`);
  if (!existing) {
    const blocker = redemptionBlocker(reader, input);
    if (blocker) throw blocker;
  }

  const issuedAt = new Date(now);
  const expiresAt = new Date(now.getTime() + offer.validForDays * 24 * 60 * 60 * 1000);
  const voucher: IssuedVoucher = {
    id: input.redemptionId,
    code: input.code,
    userId: redeemer.userId,
    offerId: offer.id,
    partnerId: offer.partnerId,
    partnerName: offer.partnerName,
    category: offer.category,
    title: offer.title,
    discount: offer.discount,
    costCoins: offer.costCoins,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return {
    draft: existing ?? {
      idempotencyKey: `voucher:${input.redemptionId}`,
      kind: 'voucher_redemption',
      postings: [
        { account: userAccount(redeemer.userId, 'winnings'), amount: -offer.costCoins },
        { account: SYSTEM.vouchers, amount: offer.costCoins },
      ],
      meta: {
        userId: redeemer.userId,
        offerId: offer.id,
        partnerId: offer.partnerId,
        redemptionId: input.redemptionId,
      },
    },
    voucher,
  };
}

/** Gives the coins back when a voucher is cancelled before use, e.g. the partner withdrew it. */
export function voucherRefund(redemption: Transaction): TransactionDraft {
  if (redemption.kind !== 'voucher_redemption') {
    throw new WalletError(
      'voucher_not_usable',
      `Transaction ${redemption.id} is not a voucher redemption.`,
    );
  }
  return {
    idempotencyKey: `voucher_refund:${redemption.meta?.redemptionId ?? redemption.id}`,
    kind: 'voucher_refund',
    postings: redemption.postings.map((p) => ({ account: p.account, amount: -p.amount })),
    meta: { ...redemption.meta, refundOf: redemption.id },
  };
}

export type VoucherStatus = 'active' | 'used' | 'expired' | 'cancelled';

export interface VoucherState {
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
}

export function voucherStatus(v: VoucherState, now: Date): VoucherStatus {
  if (v.cancelledAt) return 'cancelled';
  if (v.usedAt) return 'used';
  if (now.getTime() >= Date.parse(v.expiresAt)) return 'expired';
  return 'active';
}

/**
 * Checks a partner's attempt to accept a voucher at the till. Only the issuing partner can
 * accept it, once, before it expires; the cashier also matches the verified name the app shows.
 */
export function checkVoucherUse(
  voucher: VoucherState & { partnerId: string },
  partnerId: string,
  now: Date,
): void {
  if (voucher.partnerId !== partnerId) {
    throw new WalletError('voucher_not_usable', 'This voucher belongs to a different partner.');
  }
  const status = voucherStatus(voucher, now);
  if (status !== 'active') {
    throw new WalletError('voucher_not_usable', `This voucher is ${status}.`);
  }
}

// Crockford-style alphabet without 0/O, 1/I/L: easy to read out at a till.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A random voucher code like SC-7KQ2-M9XT. The code alone is not enough: it is tied to the account. */
export function generateVoucherCode(
  random: (bytes: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b),
): string {
  const chars: string[] = [];
  while (chars.length < 8) {
    for (const byte of random(new Uint8Array(16))) {
      // Rejection sampling keeps every character equally likely.
      if (
        byte < CODE_ALPHABET.length * Math.floor(256 / CODE_ALPHABET.length) &&
        chars.length < 8
      ) {
        chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]!);
      }
    }
  }
  return `SC-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
