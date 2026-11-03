import {
  checkDraft,
  mustStayNonNegative,
  WalletError,
  type AccountId,
  type LedgerReader,
  type LedgerStore,
  type LedgerUnitOfWork,
  type Transaction,
  type TransactionDraft,
} from '@season/wallet';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { ledgerBalance, ledgerPosting, ledgerTransaction } from '../db/schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/**
 * The coin ledger in Postgres. User and contest balances are cached in ledger_balance and
 * locked with SELECT ... FOR UPDATE (in account order, to avoid deadlocks) before a rule reads
 * them. System accounts are never locked or cached: they may go negative, and locking them
 * would make every sign-up and reward queue behind one row. Their balance is a sum of postings.
 */
export class PgLedgerStore implements LedgerStore {
  constructor(private readonly db: Database) {}

  transact<T>(work: (uow: LedgerUnitOfWork) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PgUnitOfWork(tx)));
  }

  async balance(account: AccountId): Promise<number> {
    if (mustStayNonNegative(account)) {
      const [row] = await this.db
        .select({ balance: ledgerBalance.balance })
        .from(ledgerBalance)
        .where(eq(ledgerBalance.account, account));
      return row?.balance ?? 0;
    }
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${ledgerPosting.amount})` })
      .from(ledgerPosting)
      .where(eq(ledgerPosting.account, account));
    return Number(row?.total ?? 0);
  }

  async findByKey(idempotencyKey: string): Promise<Transaction | undefined> {
    return (await loadByKeys(this.db, [idempotencyKey])).get(idempotencyKey);
  }

  async history(accounts: readonly AccountId[], limit: number): Promise<Transaction[]> {
    if (accounts.length === 0) return [];
    const ids = await this.db
      .selectDistinct({ id: ledgerTransaction.id, sequence: ledgerTransaction.sequence })
      .from(ledgerTransaction)
      .innerJoin(ledgerPosting, eq(ledgerPosting.transactionId, ledgerTransaction.id))
      .where(inArray(ledgerPosting.account, [...accounts]))
      .orderBy(desc(ledgerTransaction.sequence))
      .limit(limit);
    return loadByIds(
      this.db,
      ids.map((r) => r.id),
    );
  }

  /** Accounts whose cached balance differs from the sum of their postings. Run nightly. */
  async reconcile(): Promise<{ account: string; cached: number; posted: number }[]> {
    const rows = await this.db.execute<{ account: string; cached: string; posted: string }>(sql`
      select b.account, b.balance as cached, coalesce(sum(p.amount), 0) as posted
      from ledger_balance b left join ledger_posting p on p.account = b.account
      group by b.account, b.balance
      having b.balance <> coalesce(sum(p.amount), 0)`);
    return [...rows].map((r) => ({
      account: r.account,
      cached: Number(r.cached),
      posted: Number(r.posted),
    }));
  }
}

class PgUnitOfWork implements LedgerUnitOfWork {
  private readonly balances = new Map<AccountId, number>();
  private readonly keys = new Map<string, Transaction | undefined>();

  constructor(private readonly tx: Tx) {}

  async lock(accounts: readonly AccountId[], idempotencyKeys: readonly string[] = []) {
    const need = [...new Set(accounts)]
      .filter((a) => mustStayNonNegative(a) && !this.balances.has(a))
      .sort();
    if (need.length > 0) {
      await this.tx
        .insert(ledgerBalance)
        .values(need.map((account) => ({ account })))
        .onConflictDoNothing();
      const rows = await this.tx
        .select({ account: ledgerBalance.account, balance: ledgerBalance.balance })
        .from(ledgerBalance)
        .where(inArray(ledgerBalance.account, need))
        .orderBy(ledgerBalance.account)
        .for('update');
      for (const r of rows) this.balances.set(r.account, r.balance);
    }
    const keys = idempotencyKeys.filter((k) => !this.keys.has(k));
    if (keys.length > 0) {
      const found = await loadByKeys(this.tx, keys);
      for (const k of keys) this.keys.set(k, found.get(k));
    }
    return this.reader();
  }

  private reader(): LedgerReader {
    return {
      balance: (account) => {
        if (!mustStayNonNegative(account)) {
          throw new Error(`System account ${account} has no locked balance to read.`);
        }
        const balance = this.balances.get(account);
        if (balance === undefined) throw new Error(`Account ${account} was not locked.`);
        return balance;
      },
      findByKey: (key) => {
        if (!this.keys.has(key)) throw new Error(`Idempotency key ${key} was not loaded.`);
        return this.keys.get(key);
      },
    };
  }

  async post(draft: TransactionDraft): Promise<Transaction> {
    await this.lock(
      draft.postings.map((p) => p.account),
      [draft.idempotencyKey],
    );
    const checked = checkDraft(this.reader(), draft);
    if ('existing' in checked) return checked.existing;

    const [row] = await this.tx
      .insert(ledgerTransaction)
      .values({ idempotencyKey: draft.idempotencyKey, kind: draft.kind, meta: draft.meta ?? {} })
      .onConflictDoNothing({ target: ledgerTransaction.idempotencyKey })
      .returning();
    if (!row) {
      // A concurrent unit committed this key after we looked: return it if it is the same.
      const winner = (await loadByKeys(this.tx, [draft.idempotencyKey])).get(draft.idempotencyKey);
      this.keys.set(draft.idempotencyKey, winner);
      const again = checkDraft(this.reader(), draft);
      if ('existing' in again) return again.existing;
      throw new WalletError('idempotency_conflict', `Key ${draft.idempotencyKey} raced.`);
    }

    await this.tx
      .insert(ledgerPosting)
      .values(checked.postings.map((p) => ({ transactionId: row.id, ...p })));
    for (const p of checked.postings) {
      if (!mustStayNonNegative(p.account)) continue;
      await this.tx
        .update(ledgerBalance)
        .set({ balance: sql`${ledgerBalance.balance} + ${p.amount}`, updatedAt: sql`now()` })
        .where(eq(ledgerBalance.account, p.account));
      this.balances.set(p.account, this.balances.get(p.account)! + p.amount);
    }

    const txn = toTransaction(row, checked.postings);
    this.keys.set(txn.idempotencyKey, txn);
    return txn;
  }
}

type TxnRow = typeof ledgerTransaction.$inferSelect;

function toTransaction(row: TxnRow, postings: { account: string; amount: number }[]): Transaction {
  const meta = row.meta as Record<string, string | number>;
  return {
    id: row.id,
    sequence: row.sequence,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    postings: [...postings].sort((a, b) => (a.account < b.account ? -1 : 1)),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

async function withPostings(db: Executor, rows: TxnRow[]): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const postings = await db
    .select()
    .from(ledgerPosting)
    .where(
      inArray(
        ledgerPosting.transactionId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) =>
    toTransaction(
      r,
      postings
        .filter((p) => p.transactionId === r.id)
        .map((p) => ({ account: p.account, amount: p.amount })),
    ),
  );
}

async function loadByKeys(db: Executor, keys: string[]): Promise<Map<string, Transaction>> {
  const rows = await db
    .select()
    .from(ledgerTransaction)
    .where(inArray(ledgerTransaction.idempotencyKey, keys));
  return new Map((await withPostings(db, rows)).map((t) => [t.idempotencyKey, t]));
}

async function loadByIds(db: Executor, ids: string[]): Promise<Transaction[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(ledgerTransaction)
    .where(and(inArray(ledgerTransaction.id, ids)))
    .orderBy(desc(ledgerTransaction.sequence));
  return withPostings(db, rows);
}
