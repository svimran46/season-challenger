import { describe, expect, it } from 'vitest';
import { InMemoryLedger, WalletError, SYSTEM, userAccount, type TransactionDraft } from '../src';

const draft = (key: string, amount: number): TransactionDraft => ({
  idempotencyKey: key,
  kind: 'promotion',
  postings: [
    { account: SYSTEM.promotions, amount: -amount },
    { account: userAccount('u1', 'bonus'), amount },
  ],
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

describe('InMemoryLedger', () => {
  it('posts balanced transactions and keeps the trial balance at zero', () => {
    const ledger = new InMemoryLedger();
    ledger.post(draft('a', 300));
    ledger.post(draft('b', 200));
    expect(ledger.balance(userAccount('u1', 'bonus'))).toBe(500);
    expect(ledger.balance(SYSTEM.promotions)).toBe(-500);
    expect(ledger.trialBalance()).toBe(0);
    expect(ledger.history(userAccount('u1', 'bonus'))).toHaveLength(2);
  });

  it('returns the original transaction when a key is retried', () => {
    const ledger = new InMemoryLedger();
    const first = ledger.post(draft('a', 300));
    const retry = ledger.post(draft('a', 300));
    expect(retry).toBe(first);
    expect(ledger.balance(userAccount('u1', 'bonus'))).toBe(300);
  });

  it('refuses a reused key with different postings', () => {
    const ledger = new InMemoryLedger();
    ledger.post(draft('a', 300));
    expect(code(() => ledger.post(draft('a', 999)))).toBe('idempotency_conflict');
  });

  it('refuses unbalanced, empty, fractional and overdrawing transactions', () => {
    const ledger = new InMemoryLedger();
    expect(
      code(() =>
        ledger.post({
          idempotencyKey: 'x',
          kind: 'promotion',
          postings: [{ account: SYSTEM.promotions, amount: 5 }],
        }),
      ),
    ).toBe('unbalanced');
    expect(code(() => ledger.post({ idempotencyKey: 'y', kind: 'promotion', postings: [] }))).toBe(
      'empty',
    );
    expect(code(() => ledger.post(draft('z', 1.5)))).toBe('invalid_amount');
    expect(
      code(() =>
        ledger.post({
          idempotencyKey: 'w',
          kind: 'promotion',
          postings: [
            { account: userAccount('u1', 'bonus'), amount: -1 },
            { account: SYSTEM.promotions, amount: 1 },
          ],
        }),
      ),
    ).toBe('negative_balance');
    expect(ledger.all()).toHaveLength(0);
  });

  it('can rebuild every balance from postings', () => {
    const ledger = new InMemoryLedger();
    ledger.post(draft('a', 300));
    ledger.post(draft('b', 50));
    const rebuilt = ledger.recomputedBalances();
    expect(rebuilt.get(userAccount('u1', 'bonus'))).toBe(350);
    expect(rebuilt.get(SYSTEM.promotions)).toBe(-350);
  });
});
