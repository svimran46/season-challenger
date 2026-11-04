import { signUpBonus } from '@season/wallet';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client';
import { PgLedgerStore } from '../../src/ledger/pg-ledger.store';
import { PgPartnerStore } from '../../src/partner/pg-partner.store';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const store = new PgPartnerStore(db);

const at = new Date('2026-09-01T07:00:00Z');
const VOUCHER = '0b7d6c8e-5f43-4c7a-9a52-2f7f0c1d9e01';
let staffA: string;
let staffB: string;

beforeEach(async () => {
  await db.execute(sql`truncate partner_session, partner_staff, voucher, voucher_offer,
    voucher_partner, app_user, ledger_posting, ledger_balance, ledger_transaction cascade`);
  await store.ensurePartner({ id: 'cafe', name: 'Café', category: 'shop' });
  const staff = (email: string) =>
    store.createStaff({
      partnerId: 'cafe',
      email,
      name: email,
      role: 'cashier',
      passwordHash: 'x',
    });
  staffA = (await staff('a@cafe.example')).id;
  staffB = (await staff('b@cafe.example')).id;
  const txn = await new PgLedgerStore(db).transact((uow) => uow.post(signUpBonus('holder')));
  await db.execute(sql`insert into app_user (id, auth_id) values ('holder', 'dev:holder')`);
  await db.execute(sql`insert into voucher_offer (id, partner_id, category, title, terms, cost_coins,
      discount, valid_for_days, available_from)
    values ('o1', 'cafe', 'shop', 'Coffee', 'One per visit', 200,
      '{"kind":"amount","amountBdt":100,"minSpendBdt":200}', 30, ${at.toISOString()}::timestamptz)`);
  await db.execute(sql`insert into voucher (id, code, user_id, offer_id, partner_id, partner_name,
      category, title, discount, cost_coins, issued_at, expires_at, redemption_txn_id)
    values (${VOUCHER}, 'SC-AAAA-BBBB', 'holder', 'o1', 'cafe', 'Café', 'shop', 'Coffee',
      '{"kind":"amount","amountBdt":100,"minSpendBdt":200}', 200, ${at.toISOString()}::timestamptz,
      ${new Date(at.getTime() + 86_400_000).toISOString()}::timestamptz, ${txn.id})`);
});
afterAll(close);

const accept = (staffId: string, requestId = randomUUID(), when = at) =>
  store.markUsed({
    voucherId: VOUCHER,
    partnerId: 'cafe',
    staffId,
    reference: `R-${staffId}`,
    requestId,
    at: when,
  });

describe('PgPartnerStore', () => {
  it('lets exactly one of many simultaneous acceptances win', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => accept(i % 2 ? staffA : staffB)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const found = await store.findVoucher('cafe', 'SC-AAAA-BBBB');
    expect(found?.usedAt).toBe(at.toISOString());
    expect(found?.terms).toBe('One per visit');
    expect(found?.usedByStaffName).toMatch(/@cafe\.example$/);
  });

  it('refuses an expired voucher, and finds a retry by its request id', async () => {
    expect(await accept(staffA, randomUUID(), new Date(at.getTime() + 2 * 86_400_000))).toBe(false);
    const requestId = randomUUID();
    expect(await accept(staffA, requestId)).toBe(true);
    expect((await store.findAcceptance('cafe', requestId))?.code).toBe('SC-AAAA-BBBB');
    expect(await store.findAcceptance('other', requestId)).toBeNull();
    const [row] = await store.listAccepted('cafe', { limit: 5 });
    expect(row?.code).toBe('SC-AAAA-BBBB');
    expect(JSON.stringify(row)).not.toContain('holder');
  });

  it('only finds a partner its own vouchers', async () => {
    expect(await store.findVoucher('other', 'SC-AAAA-BBBB')).toBeNull();
  });
});
