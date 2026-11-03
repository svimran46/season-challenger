import { describe, expect, it } from 'vitest';
import {
  contestEntry,
  contestSetup,
  MemoryLedgerStore,
  signUpBonus,
  userAccount,
  WalletError,
} from '../src';

describe('MemoryLedgerStore', () => {
  it('runs units of work one at a time so two joins cannot overspend', async () => {
    const store = new MemoryLedgerStore();
    await store.transact(async (uow) => uow.post(signUpBonus('u1')));
    const terms = contestSetup({ id: 'c1', format: 'mega', entryFee: 200, capacity: 50 });
    const join = (n: number) =>
      store.transact(async (uow) => {
        const reader = await uow.lock([userAccount('u1', 'bonus'), userAccount('u1', 'winnings')]);
        return uow.post(
          contestEntry(reader, terms, { entryId: `e${n}`, userId: 'u1', currentEntries: n }),
        );
      });
    const results = await Promise.allSettled([0, 1, 2, 3].map(join));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as WalletError).code),
    ).toEqual(['insufficient_funds', 'insufficient_funds']);
    expect(await store.balance(userAccount('u1', 'bonus'))).toBe(100);
  });

  it('rolls back everything a failed unit posted', async () => {
    const store = new MemoryLedgerStore();
    await expect(
      store.transact(async (uow) => {
        await uow.post(signUpBonus('u1'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.balance(userAccount('u1', 'bonus'))).toBe(0);
    expect(await store.findByKey('sign_up_bonus:u1')).toBeUndefined();
    expect(store.snapshot().trialBalance()).toBe(0);
  });

  it('refuses to debit a user account that was not locked first', async () => {
    const store = new MemoryLedgerStore();
    await store.transact(async (uow) => uow.post(signUpBonus('u1')));
    const terms = contestSetup({ id: 'c1', format: 'head_to_head', entryFee: 10 });
    await expect(
      store.transact(async (uow) =>
        uow.post(
          contestEntry(store.snapshot(), terms, { entryId: 'e', userId: 'u1', currentEntries: 0 }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'negative_balance' });
  });

  it('lists an account history newest first', async () => {
    const store = new MemoryLedgerStore();
    await store.transact(async (uow) => uow.post(signUpBonus('u1')));
    await store.transact(async (uow) => uow.post(signUpBonus('u2')));
    const history = await store.history([userAccount('u1', 'bonus')], 10);
    expect(history.map((t) => t.idempotencyKey)).toEqual(['sign_up_bonus:u1']);
  });
});
