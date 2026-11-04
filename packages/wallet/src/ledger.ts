import { mustStayNonNegative, type AccountId } from './accounts';
import { WalletError } from './errors';

export type TransactionKind =
  | 'sign_up_bonus'
  | 'promotion'
  | 'reward'
  | 'contest_entry'
  | 'entry_refund'
  | 'contest_settlement'
  | 'voucher_redemption'
  | 'voucher_refund'
  | 'deposit'
  | 'deposit_refund'
  | 'redeem'
  | 'coin_to_cash'
  | 'withdraw_hold'
  | 'withdraw_release'
  | 'withdraw_paid';

export const TRANSACTION_KINDS: readonly TransactionKind[] = [
  'sign_up_bonus',
  'promotion',
  'reward',
  'contest_entry',
  'entry_refund',
  'contest_settlement',
  'voucher_redemption',
  'voucher_refund',
  'deposit',
  'deposit_refund',
  'redeem',
  'coin_to_cash',
  'withdraw_hold',
  'withdraw_release',
  'withdraw_paid',
];

/** One side of a transaction. Positive amounts raise the account's balance. */
export interface Posting {
  account: AccountId;
  amount: number;
}

export interface TransactionDraft {
  /** The same key always means the same transaction: retries can never double-post. */
  idempotencyKey: string;
  kind: TransactionKind;
  postings: Posting[];
  meta?: Record<string, string | number>;
}

export interface Transaction extends TransactionDraft {
  id: string;
  sequence: number;
  createdAt: string;
}

/**
 * Where transactions are stored. The in-memory store backs tests and local development;
 * the Postgres store wraps the same checks in a database transaction with row locks.
 */
export interface LedgerReader {
  balance(account: AccountId): number;
  findByKey(idempotencyKey: string): Transaction | undefined;
}

/** Merges postings to the same account and drops zero lines, so equal drafts compare equal. */
export function normalisePostings(postings: readonly Posting[]): Posting[] {
  const totals = new Map<AccountId, number>();
  for (const p of postings) totals.set(p.account, (totals.get(p.account) ?? 0) + p.amount);
  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .map(([account, amount]) => ({ account, amount }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

function sameTransaction(a: TransactionDraft, b: TransactionDraft): boolean {
  return (
    a.kind === b.kind &&
    JSON.stringify(normalisePostings(a.postings)) === JSON.stringify(normalisePostings(b.postings))
  );
}

/**
 * Checks a draft against the ledger rules and returns its normalised postings, or the
 * existing transaction when the idempotency key was already used for the same draft.
 */
export function checkDraft(
  reader: LedgerReader,
  draft: TransactionDraft,
): { existing: Transaction } | { postings: Posting[] } {
  const existing = reader.findByKey(draft.idempotencyKey);
  if (existing) {
    if (!sameTransaction(existing, draft)) {
      throw new WalletError(
        'idempotency_conflict',
        `Key ${draft.idempotencyKey} was already used for a different transaction.`,
      );
    }
    return { existing };
  }

  for (const p of draft.postings) {
    if (!Number.isSafeInteger(p.amount)) {
      throw new WalletError(
        'invalid_amount',
        `Amount ${p.amount} on ${p.account} is not a whole number.`,
      );
    }
  }
  const postings = normalisePostings(draft.postings);
  if (postings.length === 0) throw new WalletError('empty', 'A transaction needs postings.');
  const sum = postings.reduce((total, p) => total + p.amount, 0);
  if (sum !== 0) throw new WalletError('unbalanced', `Postings sum to ${sum}, not 0.`);

  for (const p of postings) {
    if (mustStayNonNegative(p.account) && reader.balance(p.account) + p.amount < 0) {
      throw new WalletError(
        'negative_balance',
        `${p.account} would go negative (${reader.balance(p.account)} + ${p.amount}).`,
      );
    }
  }
  return { postings };
}

/** Append-only, double-entry ledger held in memory. */
export class InMemoryLedger implements LedgerReader {
  private readonly transactions: Transaction[] = [];
  private readonly byKey = new Map<string, Transaction>();
  private readonly balances = new Map<AccountId, number>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  post(draft: TransactionDraft): Transaction {
    const checked = checkDraft(this, draft);
    if ('existing' in checked) return checked.existing;

    const txn: Transaction = {
      ...draft,
      postings: checked.postings,
      id: `txn_${this.transactions.length + 1}`,
      sequence: this.transactions.length + 1,
      createdAt: this.clock().toISOString(),
    };
    this.transactions.push(txn);
    this.byKey.set(txn.idempotencyKey, txn);
    for (const p of txn.postings) this.balances.set(p.account, this.balance(p.account) + p.amount);
    return txn;
  }

  balance(account: AccountId): number {
    return this.balances.get(account) ?? 0;
  }

  findByKey(idempotencyKey: string): Transaction | undefined {
    return this.byKey.get(idempotencyKey);
  }

  /** Every transaction touching an account, oldest first. */
  history(account: AccountId): Transaction[] {
    return this.transactions.filter((t) => t.postings.some((p) => p.account === account));
  }

  /** Sum of every balance. Double entry means this is always 0. */
  trialBalance(): number {
    let total = 0;
    for (const amount of this.balances.values()) total += amount;
    return total;
  }

  /** Recomputes balances from postings, for nightly reconciliation against the cache. */
  recomputedBalances(): Map<AccountId, number> {
    const totals = new Map<AccountId, number>();
    for (const t of this.transactions) {
      for (const p of t.postings) totals.set(p.account, (totals.get(p.account) ?? 0) + p.amount);
    }
    return totals;
  }

  all(): readonly Transaction[] {
    return this.transactions;
  }

  /** Drops every transaction after the first `count`: the in-memory store's rollback. */
  truncate(count: number): void {
    for (const t of this.transactions.splice(count)) {
      this.byKey.delete(t.idempotencyKey);
      for (const p of t.postings) this.balances.set(p.account, this.balance(p.account) - p.amount);
    }
  }
}
