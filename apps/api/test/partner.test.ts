import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PARTNER_STORE } from '../src/common/tokens';
import { hashPassword } from '../src/partner/password';
import type { PartnerStore } from '../src/partner/partner.store';
import { DEMO_OFFERS } from './demo-catalogue';

let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
let app: INestApplication;
const http = () => request(app.getHttpServer());
const as = (userId: string) => ({ 'x-user-id': userId });
const PASSWORD = 'correct horse battery';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let cafeToken: string;
let otherToken: string;
let voucher: { id: string; code: string };

/** Gives a player winnings by playing and winning a private head-to-head. */
async function winCoins() {
  const squad = async (shift: number) => {
    const { body } = await http().get('/v1/fixtures/fx-4-1').expect(200);
    type P = {
      id: string;
      clubId: string;
      position: 'GK' | 'DEF' | 'MID' | 'FWD';
      credits: number;
    };
    const players = (body.players as P[]).slice().sort((a, b) => a.credits - b.credits);
    const need = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
    const perClub = new Map<string, number>();
    const picked: P[] = [];
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
      for (const p of players.filter((x) => x.position === pos).slice(pos === 'MID' ? shift : 0)) {
        if (picked.filter((x) => x.position === pos).length === need[pos]) break;
        if ((perClub.get(p.clubId) ?? 0) >= 7) continue;
        picked.push(p);
        perClub.set(p.clubId, (perClub.get(p.clubId) ?? 0) + 1);
      }
    }
    const ids = picked.map((p) => p.id);
    return { playerIds: ids, captainId: ids[9]!, viceCaptainId: ids[5]! };
  };
  const created = await http()
    .post('/v1/contests')
    .set(as('holder'))
    .send({ fixtureId: 'fx-4-1', name: 'Till test', entryFee: 450, capacity: 2 })
    .expect(201);
  for (const [user, shift] of [
    ['holder', 0],
    ['rival', 1],
  ] as const) {
    await http()
      .post(`/v1/contests/${created.body.id}/entries`)
      .set(as(user))
      .send(await squad(shift))
      .expect(201);
  }
  now = new Date('2026-09-06T00:00:00Z');
  const contest = await http().get(`/v1/contests/${created.body.id}`).expect(200);
  expect(contest.body.status).toBe('settled');
}

beforeAll(async () => {
  app = await createApp({
    feed,
    clock,
    offers: DEMO_OFFERS,
    logger: false,
    workerSeconds: 0,
    partner: {
      presentSecret: 'test-present-secret',
      limits: {
        signInPerAccount: { maxAttempts: 3, windowSeconds: 900 },
        signInPerIp: { maxAttempts: 1000, windowSeconds: 900 },
        voucherPerStaff: { maxAttempts: 4, windowSeconds: 300 },
        voucherPerIp: { maxAttempts: 1000, windowSeconds: 300 },
      },
    },
  });
  await app.listen(0);

  const store = app.get<PartnerStore>(PARTNER_STORE, { strict: false });
  const passwordHash = await hashPassword(PASSWORD);
  await store.ensurePartner({ id: 'demo-cafe', name: 'Demo Café', category: 'shop' });
  await store.ensurePartner({ id: 'other-shop', name: 'Other Shop', category: 'shop' });
  await store.createStaff({
    partnerId: 'demo-cafe',
    email: 'cashier@cafe.example',
    name: 'Rina',
    role: 'cashier',
    passwordHash,
  });
  await store.createStaff({
    partnerId: 'other-shop',
    email: 'cashier@other.example',
    name: 'Tanvir',
    role: 'cashier',
    passwordHash,
  });
  const login = async (email: string) =>
    (await http().post('/v1/partner/auth/login').send({ email, password: PASSWORD }).expect(200))
      .body.token as string;
  await winCoins();
  // After the clock has moved: a staff session lasts one shift.
  cafeToken = await login('cashier@cafe.example');
  otherToken = await login('cashier@other.example');
  let rich = 'holder';
  const wallet = await http().get('/v1/me/wallet').set(as('holder')).expect(200);
  if (wallet.body.winnings < 200) rich = 'rival';
  await http()
    .post('/v1/me/verification')
    .set(as(rich))
    .send({ birthDate: '1996-07-15', documentNumber: `NID-${rich}-0001` });
  holder = rich;
  const redeemed = await http()
    .post('/v1/vouchers/redeem')
    .set(as(holder))
    .send({ offerId: 'demo-cafe-15', requestId: randomUUID() });
  if (redeemed.status === 201) voucher = redeemed.body;
});
let holder = 'holder';
afterAll(async () => {
  await app.close();
});

const presentCode = async (user = holder) =>
  (await http().post(`/v1/me/vouchers/${voucher.id}/present`).set(as(user)).expect(200)).body
    .code as string;

describe('partner sign-in', () => {
  it('gives one answer for a wrong password and an unknown email', async () => {
    const wrong = await http()
      .post('/v1/partner/auth/login')
      .send({ email: 'cashier@cafe.example', password: 'not the password' })
      .expect(401);
    const unknown = await http()
      .post('/v1/partner/auth/login')
      .send({ email: 'nobody@cafe.example', password: PASSWORD })
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('throttles repeated failures on one account', async () => {
    const email = 'guess@cafe.example';
    for (let i = 0; i < 3; i += 1) {
      await http().post('/v1/partner/auth/login').send({ email, password: 'x' }).expect(401);
    }
    const res = await http().post('/v1/partner/auth/login').send({ email, password: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('too_many_attempts');
  });

  it('is separate from player sign-in', async () => {
    await http().get('/v1/partner/me').expect(401);
    await http().get('/v1/partner/me').set(as('holder')).expect(401);
    const me = await http().get('/v1/partner/me').set(bearer(cafeToken)).expect(200);
    expect(me.body).toMatchObject({ staff: { name: 'Rina' }, partner: { id: 'demo-cafe' } });
    expect(me.body.staff.passwordHash).toBeUndefined();
  });
});

describe('the holder code', () => {
  it('is only for the signed-in holder', async () => {
    expect(voucher?.id).toBeTruthy();
    const other = holder === 'holder' ? 'rival' : 'holder';
    await http().post(`/v1/me/vouchers/${voucher.id}/present`).expect(401);
    await http().post(`/v1/me/vouchers/${voucher.id}/present`).set(as(other)).expect(404);
    expect(await presentCode()).toMatch(/^\d{6}$/);
  });
});

describe('accepting a voucher', () => {
  const check = (token: string, code: string, present: string) =>
    http()
      .post('/v1/partner/vouchers/check')
      .set(bearer(token))
      .send({ code, presentCode: present });

  it('never takes a bare or stale code, and gives the same failure every way', async () => {
    const present = await presentCode();
    const wrongPresent = await check(
      cafeToken,
      voucher.code,
      present === '000000' ? '111111' : '000000',
    );
    expect(wrongPresent.status).toBe(404);
    const wrongCode = await check(cafeToken, 'SC-2222-2222', present);
    expect(wrongCode.status).toBe(404);
    expect(wrongCode.body).toEqual(wrongPresent.body);
    const otherPartner = await check(otherToken, voucher.code, present);
    expect(otherPartner.body).toEqual(wrongPresent.body);

    const stale = await presentCode();
    now = new Date(now.getTime() + 5 * 60 * 1000);
    expect((await check(cafeToken, voucher.code, stale)).status).toBe(404);
  });

  it('shows the offer without saying who the holder is, however the code is typed', async () => {
    const res = await check(
      cafeToken,
      voucher.code.toLowerCase().replace(/-/g, ' '),
      await presentCode(),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      canAccept: true,
      status: 'active',
      title: expect.any(String),
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(holder);
    expect(text).not.toContain('birth');
  });

  it('accepts once, returns the first result on a retry, and refuses a second use', async () => {
    const body = {
      code: voucher.code,
      presentCode: await presentCode(),
      reference: 'RECEIPT-1',
      requestId: randomUUID(),
    };
    const send = () => http().post('/v1/partner/vouchers/accept').set(bearer(cafeToken)).send(body);
    const first = await send().expect(200);
    expect(first.body).toMatchObject({
      status: 'used',
      usedReference: 'RECEIPT-1',
      acceptedBy: 'Rina',
    });
    const retry = await send().expect(200);
    expect(retry.body).toEqual(first.body);

    const second = await http()
      .post('/v1/partner/vouchers/accept')
      .set(bearer(cafeToken))
      .send({ ...body, reference: 'RECEIPT-2', requestId: randomUUID() })
      .expect(409);
    expect(second.body.error).toBe('voucher_not_usable');

    const mine = await http().get('/v1/me/vouchers').set(as(holder)).expect(200);
    expect(mine.body[0].status).toBe('used');
    await http().post(`/v1/me/vouchers/${voucher.id}/present`).set(as(holder)).expect(409);
  });

  it('lists accepted vouchers for that partner only', async () => {
    const mine = await http().get('/v1/partner/vouchers').set(bearer(cafeToken)).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.nextCursor).toBeNull();
    const theirs = await http().get('/v1/partner/vouchers').set(bearer(otherToken)).expect(200);
    expect(theirs.body.items).toEqual([]);
  });

  it('throttles guessing per staff member, and ends sessions on sign-out', async () => {
    let last = 200;
    for (let i = 0; i < 6; i += 1) {
      last = (await check(otherToken, `SC-2222-222${i}`, '123456')).status;
    }
    expect(last).toBe(429);
    await http().post('/v1/partner/auth/logout').set(bearer(otherToken)).expect(204);
    await http().get('/v1/partner/me').set(bearer(otherToken)).expect(401);
  });
});
