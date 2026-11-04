import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createDatabase } from '../../src/db/client';
import { FeedSync } from '../../src/feed/feed-sync';
import { PgLedgerStore } from '../../src/ledger/pg-ledger.store';

/*
 * The match-day flow from test/economy.test.ts, against Postgres: players, tournaments, entries,
 * vouchers and coins all live in the database. The worker timer is off, so the test syncs the
 * feed itself whenever it moves the clock.
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const ledger = new PgLedgerStore(db);

// 2026-09-01: gameweek 4 kicks off on 5 September.
let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
const sync = () => new FeedSync(db, feed).run();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const as = (userId: string) => ({ 'x-user-id': userId });

/** The app does not own the connection, so closing it for a restart keeps the database open. */
async function start() {
  app = await createApp({ feed, clock, database: { db }, workerSeconds: 0, logger: false });
  await app.listen(0);
}

/** Moves the clock and syncs the feed, as the worker would. */
async function advance(to: string) {
  now = new Date(to);
  await sync();
}

beforeAll(async () => {
  await db.execute(sql`truncate daily_check_in, contest_entry, contest, voucher, voucher_offer,
    voucher_partner, app_user, ledger_posting, ledger_balance, ledger_transaction,
    stats_snapshot, fixture, player, club, season cascade`);
  await sync();
  await start();
});
afterAll(async () => {
  await app?.close();
  await close();
});

interface P {
  id: string;
  clubId: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  credits: number;
}

/** The cheapest legal 1-4-4-2 for a fixture; `shift` picks a slightly different squad. */
async function squadFor(fixtureId: string, shift = 0) {
  const { body } = await http().get(`/v1/fixtures/${fixtureId}`).expect(200);
  const players = (body.players as P[]).slice().sort((a, b) => a.credits - b.credits);
  const need = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
  const perClub = new Map<string, number>();
  const picked: P[] = [];
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
    const pool = players.filter((p) => p.position === pos);
    for (const p of pool.slice(pos === 'MID' ? shift : 0)) {
      if (picked.filter((x) => x.position === pos).length === need[pos]) break;
      if ((perClub.get(p.clubId) ?? 0) >= 7) continue;
      picked.push(p);
      perClub.set(p.clubId, (perClub.get(p.clubId) ?? 0) + 1);
    }
  }
  const ids = picked.map((p) => p.id);
  return { playerIds: ids, captainId: ids[9]!, viceCaptainId: ids[5]! };
}

describe('coins', () => {
  it('explains the coin rules: no money in or out', async () => {
    const res = await http().get('/v1/economy').expect(200);
    expect(res.body).toMatchObject({ moneyIn: false, moneyOut: false, signUpBonus: 500 });
    expect(res.body.formats.map((f: { format: string }) => f.format)).toEqual([
      'head_to_head',
      'small_league',
      'mega',
      'private',
    ]);
  });

  it('needs a player id, then gives each new player 500 bonus coins once', async () => {
    await http().get('/v1/me/wallet').expect(401);
    await http().get('/v1/me/wallet').set(as('x')).expect(401);
    const first = await http().get('/v1/me/wallet').set(as('alice')).expect(200);
    const again = await http().get('/v1/me/wallet').set(as('alice')).expect(200);
    expect(first.body).toMatchObject({ bonus: 500, winnings: 0, total: 500, redeemable: 0 });
    expect(again.body.total).toBe(500);
    const activity = await http().get('/v1/me/wallet/activity').set(as('alice')).expect(200);
    expect(activity.body).toEqual([
      expect.objectContaining({ kind: 'sign_up_bonus', bonus: 500, winnings: 0 }),
    ]);
  });

  it('pays the daily check-in once per Dhaka day and counts the streak', async () => {
    const first = await http().post('/v1/me/check-in').set(as('alice')).expect(200);
    expect(first.body).toMatchObject({ today: '2026-09-01', streak: 1, coins: 20 });
    const twice = await http().post('/v1/me/check-in').set(as('alice')).expect(200);
    expect(twice.body).toMatchObject({ alreadyCheckedIn: true, coins: 0 });
    await advance('2026-09-01T18:30:00Z'); // 00:30 on 2 September in Dhaka
    const next = await http().post('/v1/me/check-in').set(as('alice')).expect(200);
    expect(next.body).toMatchObject({ today: '2026-09-02', streak: 2, coins: 20 });
    const wallet = await http().get('/v1/me/wallet').set(as('alice')).expect(200);
    expect(wallet.body).toMatchObject({ bonus: 540, checkIn: { checkedIn: true, streak: 2 } });
  });
});

describe('tournaments', () => {
  it('lists the public tournaments for an upcoming match only', async () => {
    const res = await http().get('/v1/contests?fixtureId=fx-4-1').expect(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([
      'fx-4-1~h2h-25~1',
      'fx-4-1~h2h-100~1',
      'fx-4-1~league-50~1',
      'fx-4-1~mega-20~1',
    ]);
    expect(res.body[0]).toMatchObject({ entryFee: 25, capacity: 2, topPrize: 42, spotsLeft: 2 });
    const done = await http().get('/v1/contests?fixtureId=fx-1-1').expect(200);
    expect(done.body).toEqual([]);
    await http().get('/v1/contests?fixtureId=nope').expect(404);
  });

  it('takes the entry fee, refuses bad squads and second entries, and refills when full', async () => {
    const squad = await squadFor('fx-4-1');
    await http()
      .post('/v1/contests/fx-4-1~h2h-25~1/entries')
      .set(as('alice'))
      .send({ ...squad, captainId: 'nobody' })
      .expect(422);
    await http()
      .post('/v1/contests/fx-4-1~h2h-25~1/entries')
      .set(as('alice'))
      .send(squad)
      .expect(201);
    const again = await http()
      .post('/v1/contests/fx-4-1~h2h-25~1/entries')
      .set(as('alice'))
      .send(squad)
      .expect(409);
    expect(again.body.error).toBe('already_joined');
    await http()
      .post('/v1/contests/fx-4-1~h2h-25~1/entries')
      .set(as('bob'))
      .send(await squadFor('fx-4-1', 1))
      .expect(201);
    const full = await http()
      .post('/v1/contests/fx-4-1~h2h-25~1/entries')
      .set(as('carol'))
      .send(squad)
      .expect(409);
    expect(full.body.error).toBe('contest_full');

    const list = await http().get('/v1/contests?fixtureId=fx-4-1').expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain('fx-4-1~h2h-25~2');
    const wallet = await http().get('/v1/me/wallet').set(as('alice')).expect(200);
    expect(wallet.body.bonus).toBe(515);
  });

  it('runs a private tournament by invite code', async () => {
    const created = await http()
      .post('/v1/contests')
      .set(as('alice'))
      .send({ fixtureId: 'fx-4-1', name: 'Office league', entryFee: 400, capacity: 2 })
      .expect(201);
    expect(created.body).toMatchObject({ format: 'private', inviteCode: expect.any(String) });
    const found = await http().get(`/v1/contests/invite/${created.body.inviteCode}`).expect(200);
    expect(found.body).toMatchObject({ id: created.body.id, inviteCode: null });
    const listed = await http().get('/v1/contests?fixtureId=fx-4-1').expect(200);
    expect(listed.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);

    for (const [user, shift] of [
      ['alice', 0],
      ['bob', 2],
    ] as const) {
      await http()
        .post(`/v1/contests/${created.body.id}/entries`)
        .set(as(user))
        .send(await squadFor('fx-4-1', shift))
        .expect(201);
    }
    const poor = await http()
      .post('/v1/contests')
      .set(as('dave'))
      .send({ fixtureId: 'fx-4-1', name: 'Too rich', entryFee: 600, capacity: 2 })
      .expect(201);
    const broke = await http()
      .post(`/v1/contests/${poor.body.id}/entries`)
      .set(as('dave'))
      .send(await squadFor('fx-4-1'))
      .expect(409);
    expect(broke.body.error).toBe('insufficient_funds');
  });

  it('lets exactly capacity players into a tournament when many join at once', async () => {
    const players = Array.from({ length: 10 }, (_, i) => `rush-${i}`);
    const squad = await squadFor('fx-4-2');
    await http().get('/v1/contests?fixtureId=fx-4-2').expect(200); // seeds its tournaments
    const results = await Promise.all(
      players.map((p) =>
        http().post('/v1/contests/fx-4-2~h2h-25~1/entries').set(as(p)).send(squad),
      ),
    );
    for (const r of results) {
      if (r.status !== 201) {
        expect(r.status).toBe(409);
        expect(['contest_full', 'contest_closed']).toContain(r.body.error);
      }
    }
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);

    const rows = await db.execute<{ id: string; capacity: number; entry_count: number; n: string }>(
      sql`select c.id, c.capacity, c.entry_count, count(e.id) as n
          from contest c left join contest_entry e on e.contest_id = c.id
          group by c.id`,
    );
    for (const r of rows) {
      expect(Number(r.n)).toBeLessThanOrEqual(r.capacity);
      expect(Number(r.n)).toBe(r.entry_count);
    }
    expect(rows.find((r) => r.id === 'fx-4-2~h2h-25~1')?.n).toBe('2');
    expect(await ledger.reconcile()).toEqual([]);
  });

  it('cancels and refunds what did not fill at kick-off, and pays out the rest at full time', async () => {
    await http()
      .post('/v1/contests/fx-4-1~league-50~1/entries')
      .set(as('carol'))
      .send(await squadFor('fx-4-1'))
      .expect(201);
    expect((await http().get('/v1/me/wallet').set(as('carol'))).body.bonus).toBe(450);

    await advance('2026-09-06T00:00:00Z'); // gameweek 4 has finished
    const carol = await http().get('/v1/me/entries').set(as('carol')).expect(200);
    expect(carol.body[0].contest.status).toBe('cancelled');
    expect((await http().get('/v1/me/wallet').set(as('carol'))).body.bonus).toBe(500);

    const h2h = await http().get('/v1/contests/fx-4-1~h2h-25~1').expect(200);
    expect(h2h.body.status).toBe('settled');
    const prizes = h2h.body.leaderboard.map((r: { prize: number }) => r.prize);
    expect(prizes.reduce((a: number, b: number) => a + b, 0)).toBe(42);

    const alice = await http().get('/v1/me/entries').set(as('alice')).expect(200);
    expect(alice.body.every((e: { rank: number | null }) => e.rank !== null)).toBe(true);
    const top = h2h.body.leaderboard.find((r: { prize: number }) => r.prize > 0);
    const activity = await http().get('/v1/me/wallet/activity').set(as(top.userId)).expect(200);
    expect(activity.body[0]).toMatchObject({ kind: 'contest_settlement', bonus: 0 });
  });
});

describe('vouchers', () => {
  const winner = async () => {
    const [a, b] = await Promise.all(
      ['alice', 'bob'].map((u) => http().get('/v1/me/wallet').set(as(u))),
    );
    return a!.body.winnings >= b!.body.winnings ? 'alice' : 'bob';
  };

  it('lists shop and travel offers, with what stops a player redeeming', async () => {
    const all = await http().get('/v1/vouchers/offers').expect(200);
    expect(all.body).toHaveLength(6);
    expect(all.body[0]).toMatchObject({
      partnerName: 'Demo Café',
      discountText: '15% off, up to ৳300',
      costCoins: 200,
    });
    const travel = await http().get('/v1/vouchers/offers?category=travel').expect(200);
    expect(travel.body.every((o: { category: string }) => o.category === 'travel')).toBe(true);
    const mine = await http().get('/v1/vouchers/offers').set(as('carol')).expect(200);
    expect(mine.body[0]).toMatchObject({ canRedeem: false, reason: 'not_verified' });
  });

  it('needs an ID-verified adult and won coins, never bonus coins', async () => {
    const requestId = '0b7d6c8e-5f43-4c7a-9a52-2f7f0c1d9e01';
    const unverified = await http()
      .post('/v1/vouchers/redeem')
      .set(as('carol'))
      .send({ offerId: 'demo-cafe-15', requestId })
      .expect(403);
    expect(unverified.body.error).toBe('not_verified');

    await http()
      .post('/v1/me/verification')
      .set(as('carol'))
      .send({ birthDate: '1999-04-02', documentNumber: '1990 2612 3456' })
      .expect(200);
    const bonusOnly = await http()
      .post('/v1/vouchers/redeem')
      .set(as('carol'))
      .send({ offerId: 'demo-cafe-15', requestId })
      .expect(409);
    expect(bonusOnly.body.error).toBe('insufficient_winnings');

    const reused = await http()
      .post('/v1/me/verification')
      .set(as('dave'))
      .send({ birthDate: '1999-04-02', documentNumber: '19902612 3456' })
      .expect(409);
    expect(reused.body.error).toBe('identity_in_use');

    await http()
      .post('/v1/me/verification')
      .set(as('erin'))
      .send({ birthDate: '2009-01-01', documentNumber: 'BD-YOUNG-001' })
      .expect(200);
    const young = await http()
      .post('/v1/vouchers/redeem')
      .set(as('erin'))
      .send({ offerId: 'demo-cafe-15', requestId: '5c1a3a8e-0f2b-4f7e-8d41-7a0e9b2c6d11' })
      .expect(403);
    expect(young.body.error).toBe('under_age');
  });

  it('issues a voucher for won coins, once per request', async () => {
    const user = await winner();
    await http()
      .post('/v1/me/verification')
      .set(as(user))
      .send({ birthDate: '1996-07-15', documentNumber: `NID-${user}-0001` })
      .expect(200);
    const before = (await http().get('/v1/me/wallet').set(as(user))).body;
    expect(before.winnings).toBeGreaterThanOrEqual(340);

    const requestId = '9e2f4b1c-3d5a-4e6f-8a7b-1c2d3e4f5a6b';
    const send = () =>
      http().post('/v1/vouchers/redeem').set(as(user)).send({ offerId: 'demo-cafe-15', requestId });
    const first = await send().expect(201);
    const retry = await send().expect(201);
    expect(retry.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      code: expect.stringMatching(/^SC-[2-9A-Z]{4}-[2-9A-Z]{4}$/),
      partnerName: 'Demo Café',
      status: 'active',
      costCoins: 200,
    });

    const after = (await http().get('/v1/me/wallet').set(as(user))).body;
    expect(after.winnings).toBe(before.winnings - 200);
    expect(after.bonus).toBe(before.bonus);
    const mine = await http().get('/v1/me/vouchers').set(as(user)).expect(200);
    expect(mine.body).toHaveLength(1);

    const stolen = await http()
      .post('/v1/vouchers/redeem')
      .set(as('carol'))
      .send({ offerId: 'demo-cafe-15', requestId })
      .expect(409);
    expect(stolen.body.error).toBe('request_reused');
  });
});

describe('restart', () => {
  it('keeps wallets, entries and vouchers when the API restarts', async () => {
    const read = async () => ({
      wallets: await Promise.all(
        ['alice', 'bob', 'carol'].map(
          async (u) => (await http().get('/v1/me/wallet').set(as(u))).body,
        ),
      ),
      entries: (await http().get('/v1/me/entries').set(as('alice')).expect(200)).body,
      vouchers: await Promise.all(
        ['alice', 'bob'].map(async (u) => (await http().get('/v1/me/vouchers').set(as(u))).body),
      ),
    });
    const before = await read();
    expect(before.entries.length).toBeGreaterThan(0);
    expect(before.vouchers.flat()).toHaveLength(1);

    await app.close();
    await start();
    expect(await read()).toEqual(before);
    expect(await ledger.reconcile()).toEqual([]);
  });
});
