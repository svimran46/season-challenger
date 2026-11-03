import { mustStayNonNegative, type AccountId } from './accounts';
import { WalletError } from './errors';
import {
  InMemoryLedger,
  type LedgerReader,
  type Transaction,
  type TransactionDraft,
} from './ledger';

/**
 * One atomic piece of ledger work. `lock` loads and locks the user and contest accounts a rule
 * reads, plus any idempotency keys it looks up, so the pure functions in this package
 * (contestEntry, contestSettlement, voucherRedemption...) run against a consistent view.
 * `post` writes a draft and updates that view. Nothing is visible to other work until the
 * unit commits, and nothing is kept if it throws.
 */
export interface LedgerUnitOfWork {
  lock(accounts: readonly AccountId[], idempotencyKeys?: readonly string[]): Promise<LedgerReader>;
  post(draft: TransactionDraft): Promise<Transaction>;
}

export interface LedgerStore {
  transact<T>(work: (uow: LedgerUnitOfWork) => Promise<T>): Promise<T>;
  balance(account: AccountId): Promise<number>;
  findByKey(idempotencyKey: string): Promise<Transaction | undefined>;
  /** Newest first. */
  history(accounts: readonly AccountId[], limit: number): Promise<Transaction[]>;
}

/**
 * The in-memory store for tests and local development. Units of work run one at a time, and a
 * unit that throws is rolled back by replaying the ledger without its transactions.
 */
export class MemoryLedgerStore implements LedgerStore {
  private readonly ledger: InMemoryLedger;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(clock: () => Date = () => new Date()) {
    this.ledger = new InMemoryLedger(clock);
  }

  transact<T>(work: (uow: LedgerUnitOfWork) => Promise<T>): Promise<T> {
    const run = async () => {
      const before = this.ledger.all().length;
      const ledger = this.ledger;
      const locked = new Set<AccountId>();
      const uow: LedgerUnitOfWork = {
        lock: async (accounts) => {
          for (const a of accounts) locked.add(a);
          return ledger;
        },
        post: async (draft) => {
          for (const p of draft.postings) {
            if (mustStayNonNegative(p.account) && !locked.has(p.account) && p.amount < 0) {
              throw new WalletError(
                'negative_balance',
                `${p.account} is debited without being locked first.`,
              );
            }
          }
          return ledger.post(draft);
        },
      };
      try {
        return await work(uow);
      } catch (e) {
        ledger.truncate(before);
        throw e;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async balance(account: AccountId): Promise<number> {
    return this.ledger.balance(account);
  }

  async findByKey(idempotencyKey: string): Promise<Transaction | undefined> {
    return this.ledger.findByKey(idempotencyKey);
  }

  async history(accounts: readonly AccountId[], limit: number): Promise<Transaction[]> {
    const wanted = new Set(accounts);
    return this.ledger
      .all()
      .filter((t) => t.postings.some((p) => wanted.has(p.account)))
      .slice(-limit)
      .reverse();
  }

  /** The underlying ledger, for reconciliation checks in tests. */
  snapshot(): InMemoryLedger {
    return this.ledger;
  }
}
