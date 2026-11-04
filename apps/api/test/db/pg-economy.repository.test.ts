import { FakeFeed } from '@season/feed';
import {
  contestSetup,
  dailyCheckIn,
  signUpBonus,
  SYSTEM,
  userAccount,
  type LedgerUnitOfWork,
  type VoucherOffer,
} from '@season/wallet';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client';
import { PgEconomyRepository } from '../../src/economy/pg-economy.repository';
import {
  IdentityInUseError,
  type ContestRecord,
  type PlayerProfile,
  type VoucherRecord,
} from '../../src/economy/stores';
import { FeedSync } from '../../src/feed/feed-sync';
import { PgLedgerStore } from '../../src/ledger/pg-ledger.store';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const ledger = new PgLedgerStore(db);
const repo = new PgEconomyRepository(db);

const fake = new FakeFeed({
  seasonStart: '2026-08-15T14:00:00.000Z',
  now: () => new Date('2026-09-01T06:00:00Z'),
});
const FIXTURE = 'fx-4-1';

const profile = (id: string): PlayerProfile => ({
  id,
  createdAt: '2026-09-01T06:00:00.000Z',
  birthDate: null,
  idVerifiedAt: null,
  idDocumentHash: null,
  redemptionsBlocked: false,
  lastCheckIn: null,
});

/** Creates the player and pays their sign-up bonus, as WalletService does. */
const player = (id: string) =>
  ledger.transact(async (uow) => {
    await uow.post(signUpBonus(id));
    return repo.createPlayer(profile(id), uow);
  });

const publicContest = (id: string, templateKey = 'h2h-25'): ContestRecord => ({
  ...contestSetup({ id, format: 'head_to_head', entryFee: 25 }),
  fixtureId: FIXTURE,
  name: 'Head-to-head',
  status: 'open',
  inviteCode: null,
  createdBy: null,
  templateKey,
  entryCount: 0,
  createdAt: '2026-09-01T06:00:00.000Z',
  settledAt: null,
});

const offer = (over: Partial<VoucherOffer> = {}): VoucherOffer => ({
  id: 'cafe-15',
  partnerId: 'cafe',
  partnerName: 'Café',
  category: 'shop',
  title: '15% off',
  terms: 'Dine-in only.',
  costCoins: 200,
  discount: { kind: 'percent', percent: 15, maxDiscountBdt: 300, minSpendBdt: 0 },
  validForDays: 30,
  stock: 2,
  perUserMonthlyLimit: 2,
  availableFrom: '2026-01-01T00:00:00.000Z',
  availableUntil: null,
  active: true,
  ...over,
});

beforeEach(async () => {
  await db.execute(sql`truncate voucher, voucher_offer, voucher_partner, contest_entry, contest,
    daily_check_in, app_user, ledger_posting, ledger_balance, ledger_transaction,
    stats_snapshot, fixture, player, club, season cascade`);
  await new FeedSync(db, fake).run();
});
afterAll(close);

describe('PgEconomyRepository players', () => {
  it('creates a player once and reads back their latest check-in', async () => {
    const first = await player('u1');
    const again = await ledger.transact((uow) => repo.createPlayer(profile('u1'), uow));
    expect(again).toEqual(first);
    expect(first.lastCheckIn).toBeNull();

    for (const [date, streak] of [
      ['2026-09-01', 1],
      ['2026-09-02', 2],
    ] as const) {
      await ledger.transact(async (uow) => {
        const txn = await uow.post(dailyCheckIn('u1', date, streak));
        await repo.recordCheckIn('u1', { date, streak, rewardTxnId: txn.id }, uow);
      });
    }
    expect((await repo.getPlayer('u1'))?.lastCheckIn).toEqual({ date: '2026-09-02', streak: 2 });
    expect(await repo.getPlayer('nobody')).toBeUndefined();
  });

  it('lets one ID document verify one account only', async () => {
    await player('u1');
    await player('u2');
    const v = {
      birthDate: '1990-05-01',
      idDocumentHash: 'h1',
      idVerifiedAt: '2026-09-01T07:00:00.000Z',
    };
    await repo.recordVerification('u1', v);
    expect(await repo.getPlayer('u1')).toMatchObject({
      birthDate: '1990-05-01',
      idDocumentHash: 'h1',
      idVerifiedAt: '2026-09-01T07:00:00.000Z',
    });
    expect((await repo.findPlayerByDocumentHash('h1'))?.id).toBe('u1');
    await expect(repo.recordVerification('u2', v)).rejects.toBeInstanceOf(IdentityInUseError);
  });
});

describe('PgEconomyRepository tournaments', () => {
  it('inserts a contest only if its id is new, and filters the list', async () => {
    const c = publicContest(`${FIXTURE}~h2h-25~1`);
    expect(await repo.insertContest(c)).toBe(true);
    expect(await repo.insertContest({ ...c, name: 'Other' })).toBe(false);
    expect(await repo.getContest(c.id)).toEqual(c);
    expect(await repo.listContests({ fixtureId: FIXTURE, statuses: ['open'] })).toEqual([c]);
    expect(await repo.listContests({ templateKey: 'mega-20' })).toEqual([]);
    expect(await repo.listContests({ statuses: [] })).toEqual([]);

    const priv: ContestRecord = {
      ...contestSetup({ id: `${FIXTURE}~private~X`, format: 'private', entryFee: 10, capacity: 4 }),
      fixtureId: FIXTURE,
      name: 'Office',
      status: 'open',
      inviteCode: 'ABC234',
      createdBy: (await player('u1')).id,
      templateKey: null,
      entryCount: 0,
      createdAt: '2026-09-01T06:01:00.000Z',
      settledAt: null,
    };
    await repo.insertContest(priv);
    expect(await repo.contestByInviteCode('ABC234')).toEqual(priv);
    expect(await repo.inviteCodeTaken('ABC234')).toBe(true);
    expect(await repo.inviteCodeTaken('ZZZ999')).toBe(false);

    await ledger.transact((uow) =>
      repo.updateContest(c.id, { status: 'settled', settledAt: '2026-09-05T20:00:00.000Z' }, uow),
    );
    expect(await repo.getContest(c.id)).toMatchObject({
      status: 'settled',
      settledAt: '2026-09-05T20:00:00.000Z',
    });
  });

  it('stores an entry with its squad, counts it and records the result', async () => {
    const c = publicContest(`${FIXTURE}~h2h-25~1`);
    await repo.insertContest(c);
    await player('u1');
    const squad = {
      fixtureId: FIXTURE,
      playerIds: ['p1', 'p2', 'p3'],
      captainId: 'p1',
      viceCaptainId: 'p2',
    };
    const entryId = `${c.id}:u1`;
    await ledger.transact(async (uow) => {
      const txn = await uow.post(signUpBonus('u1')); // existing txn: any real id satisfies the key
      await repo.insertEntry(
        {
          id: entryId,
          contestId: c.id,
          userId: 'u1',
          squad,
          entryTxnId: txn.id,
          points: null,
          rank: null,
          prize: null,
          joinedAt: '2026-09-01T06:05:00.000Z',
        },
        uow,
      );
    });
    expect((await repo.getContest(c.id))?.entryCount).toBe(1);
    expect((await repo.getEntry(entryId))?.squad).toEqual(squad);
    expect(await repo.entriesFor(c.id)).toHaveLength(1);
    expect((await repo.entriesOfUser('u1')).map((e) => e.id)).toEqual([entryId]);

    await ledger.transact((uow) =>
      repo.recordResult(entryId, { points: 42.5, rank: 1, prize: 45 }, uow),
    );
    expect(await repo.getEntry(entryId)).toMatchObject({ points: 42.5, rank: 1, prize: 45 });
  });

  it('holds a locked contest row until the transaction ends', async () => {
    const c = publicContest(`${FIXTURE}~h2h-25~1`);
    await repo.insertContest(c);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const firstLocked = new Promise<void>((r) => (locked = r));

    const first = ledger.transact(async (uow) => {
      await repo.getContest(c.id, uow, { lock: true });
      locked();
      await held;
      order.push('first done');
    });
    await firstLocked;
    const second = ledger.transact(async (uow: LedgerUnitOfWork) => {
      await repo.getContest(c.id, uow, { lock: true });
      order.push('second locked');
    });
    await new Promise((r) => setTimeout(r, 100));
    order.push('released');
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['released', 'first done', 'second locked']);
  });
});

describe('PgEconomyRepository vouchers', () => {
  it('upserts offers without resetting their stock, and never takes stock below zero', async () => {
    await repo.upsertOffers([offer()]);
    expect(await repo.listOffers()).toEqual([offer()]);

    await ledger.transact((uow) => repo.decrementStock('cafe-15', uow));
    await repo.upsertOffers([offer({ title: '20% off', partnerName: 'Café Two' })]);
    expect(await repo.getOffer('cafe-15')).toEqual(
      offer({ title: '20% off', partnerName: 'Café Two', stock: 1 }),
    );

    await ledger.transact((uow) => repo.decrementStock('cafe-15', uow));
    await expect(ledger.transact((uow) => repo.decrementStock('cafe-15', uow))).rejects.toThrow(
      /no stock/,
    );
    expect((await repo.getOffer('cafe-15', undefined))?.stock).toBe(0);
    expect(
      await ledger.transact((uow) => repo.getOffer('cafe-15', uow, { lock: true })),
    ).toMatchObject({
      id: 'cafe-15',
    });
    expect(await repo.getOffer('nope')).toBeUndefined();
  });

  it('stores issued vouchers and lists them newest first, optionally since a date', async () => {
    await repo.upsertOffers([offer()]);
    await player('u1');
    const issue = (id: string, code: string, issuedAt: string) =>
      ledger.transact(async (uow) => {
        // A real ledger row for the foreign key; the store test covers the redemption rules.
        await uow.lock([userAccount('u1', 'bonus')]);
        const txn = await uow.post({
          idempotencyKey: `test:${id}`,
          kind: 'promotion',
          postings: [
            { account: userAccount('u1', 'bonus'), amount: 1 },
            { account: SYSTEM.promotions, amount: -1 },
          ],
        });
        const record: VoucherRecord = {
          id,
          code,
          userId: 'u1',
          offerId: 'cafe-15',
          partnerId: 'cafe',
          partnerName: 'Café',
          category: 'shop',
          title: '15% off',
          discount: offer().discount,
          costCoins: 200,
          issuedAt,
          expiresAt: new Date(Date.parse(issuedAt) + 30 * 86_400_000).toISOString(),
          usedAt: null,
          usedReference: null,
          cancelledAt: null,
          redemptionTxnId: txn.id,
        };
        await repo.insertVoucher(record, uow);
        return record;
      });
    const august = await issue(
      '00000000-0000-4000-8000-000000000001',
      'CODE-A',
      '2026-08-20T10:00:00.000Z',
    );
    const sept = await issue(
      '00000000-0000-4000-8000-000000000002',
      'CODE-B',
      '2026-09-02T10:00:00.000Z',
    );

    expect(await repo.getVoucher(august.id)).toEqual(august);
    expect(await repo.voucherCodeTaken('CODE-B')).toBe(true);
    expect(await repo.voucherCodeTaken('CODE-C')).toBe(false);
    expect(await repo.vouchersOfUser('u1')).toEqual([sept, august]);
    expect(await repo.vouchersOfUser('u1', { since: '2026-08-31T18:00:00.000Z' })).toEqual([sept]);
  });
});
