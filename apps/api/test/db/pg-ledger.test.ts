import {
  contestEntry,
  contestPool,
  contestSettlement,
  contestSetup,
  signUpBonus,
  SYSTEM,
  userAccount,
  WalletError,
} from '@season/wallet';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client';
import { PgLedgerStore } from '../../src/ledger/pg-ledger.store';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const store = new PgLedgerStore(db);

const accountsOf = (userId: string) => [
  userAccount(userId, 'bonus'),
  userAccount(userId, 'winnings'),
];

beforeEach(async () => {
  await db.execute(sql`truncate ledger_posting, ledger_balance, ledger_transaction cascade`);
});
afterAll(close);

describe('PgLedgerStore', () => {
  it('posts a sign-up bonus once, however many times it is retried at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.transact((uow) => uow.post(signUpBonus('u1')))),
    );
    expect(new Set(results.map((t) => t.id)).size).toBe(1);
    expect(await store.balance(userAccount('u1', 'bonus'))).toBe(500);
    expect(await store.balance(SYSTEM.promotions)).toBe(-500);
  });

  it('never lets concurrent entries spend more than the wallet holds', async () => {
    await store.transact((uow) => uow.post(signUpBonus('u1')));
    const terms = contestSetup({ id: 'c1', format: 'mega', entryFee: 120, capacity: 50 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, n) =>
        store.transact(async (uow) => {
          const reader = await uow.lock(accountsOf('u1'));
          return uow.post(
            contestEntry(reader, terms, { entryId: `e${n}`, userId: 'u1', currentEntries: 0 }),
          );
        }),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const refused = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(ok).toHaveLength(4);
    expect(refused.every((r) => (r.reason as WalletError).code === 'insufficient_funds')).toBe(
      true,
    );
    expect(await store.balance(userAccount('u1', 'bonus'))).toBe(20);
    expect(await store.balance(contestPool('c1'))).toBe(480);
    expect(await store.reconcile()).toEqual([]);
  });

  it('rolls back everything when a unit of work fails', async () => {
    await expect(
      store.transact(async (uow) => {
        await uow.post(signUpBonus('u1'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.balance(userAccount('u1', 'bonus'))).toBe(0);
    expect(await store.findByKey('sign_up_bonus:u1')).toBeUndefined();
  });

  it('settles a tournament once even if the job runs twice', async () => {
    const terms = contestSetup({ id: 'c2', format: 'head_to_head', entryFee: 100 });
    for (const [n, userId] of ['a', 'b'].entries()) {
      await store.transact(async (uow) => {
        await uow.post(signUpBonus(userId));
        const reader = await uow.lock(accountsOf(userId));
        return uow.post(
          contestEntry(reader, terms, { entryId: userId, userId, currentEntries: n }),
        );
      });
    }
    const results = [
      { entryId: 'a', userId: 'a', points: 40 },
      { entryId: 'b', userId: 'b', points: 55 },
    ];
    const settle = () =>
      store.transact(async (uow) => {
        const reader = await uow.lock(
          [contestPool('c2'), ...accountsOf('a'), ...accountsOf('b')],
          ['settle:c2'],
        );
        return uow.post(contestSettlement(reader, terms, results).draft);
      });
    const first = await settle();
    const second = await settle();
    expect(second.id).toBe(first.id);
    expect(await store.balance(userAccount('b', 'winnings'))).toBe(170);
    expect(await store.balance(SYSTEM.platformFees)).toBe(30);
    expect(await store.balance(contestPool('c2'))).toBe(0);
    const history = await store.history(accountsOf('b'), 10);
    expect(history.map((t) => t.kind)).toEqual([
      'contest_settlement',
      'contest_entry',
      'sign_up_bonus',
    ]);
  });

  it('keeps the trial balance at zero and refuses negative user balances in the database', async () => {
    await store.transact((uow) => uow.post(signUpBonus('u1')));
    const [row] = await db.execute<{ total: string }>(
      sql`select coalesce(sum(amount), 0) as total from ledger_posting`,
    );
    expect(Number(row!.total)).toBe(0);
    await expect(
      db.execute(sql`update ledger_balance set balance = -1 where account = 'user:u1:bonus'`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'ledger_balance_non_negative' } });
  });
});
