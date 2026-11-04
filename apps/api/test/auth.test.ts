import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemorySmsSender } from '../src/auth/sms';

let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const tick = (seconds: number) => {
  now = new Date(now.getTime() + seconds * 1000);
};
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
const sms = new MemorySmsSender();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Each test gets its own number, so limits from one test don't leak into the next. */
let n = 10_000_000;
let phone = '';
beforeEach(() => {
  n += 1;
  phone = `+88017${n}`;
});

beforeAll(async () => {
  app = await createApp({
    feed,
    clock,
    auth: { sms, settings: { codesPerAddressPerHour: 1000 } },
    logger: false,
  });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

async function signIn(number = phone) {
  await http().post('/v1/auth/code').send({ phone: number }).expect(200);
  const res = await http()
    .post('/v1/auth/verify')
    .send({ phone: number, code: sms.lastCode(number) })
    .expect(200);
  return res.body as { token: string; user: { id: string; phone: string; isNew: boolean } };
}

describe('phone sign-in', () => {
  it('texts a code to a Bangladesh number typed the local way', async () => {
    const local = `0${phone.slice(4)}`;
    const res = await http().post('/v1/auth/code').send({ phone: local }).expect(200);
    expect(res.body).toEqual({
      phone,
      maskedPhone: expect.stringMatching(/^\+880 17\d\d-\*\*\*\d{3}$/),
      expiresInSeconds: 300,
      resendInSeconds: 60,
    });
    expect(sms.lastCode(phone)).toMatch(/^\d{6}$/);
  });

  it('refuses numbers that are not Bangladesh mobiles', async () => {
    const res = await http().post('/v1/auth/code').send({ phone: '+447700900123' }).expect(400);
    expect(res.body.error).toBe('invalid_phone');
  });

  it('signs in with the right code, and the token works on signed-in routes', async () => {
    const { token, user } = await signIn();
    expect(user).toMatchObject({ phone, isNew: true, id: expect.stringMatching(/^u_/) });
    const me = await http().get('/v1/me').set(bearer(token)).expect(200);
    expect(me.body).toEqual({ id: user.id, phone });
    const wallet = await http().get('/v1/me/wallet').set(bearer(token)).expect(200);
    expect(wallet.body.bonus).toBe(500);
  });

  it('gives a returning number the same player', async () => {
    const first = await signIn();
    tick(61);
    const second = await signIn();
    expect(second.user).toMatchObject({ id: first.user.id, isNew: false });
    expect(second.token).not.toBe(first.token);
  });

  it('counts wrong guesses and locks the code after five', async () => {
    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const right = sms.lastCode(phone)!;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left--) {
      const res = await http().post('/v1/auth/verify').send({ phone, code: wrong }).expect(401);
      expect(res.body).toMatchObject({ error: 'wrong_code', attemptsLeft: left });
    }
    await http().post('/v1/auth/verify').send({ phone, code: wrong }).expect(429);
    const locked = await http().post('/v1/auth/verify').send({ phone, code: right }).expect(429);
    expect(locked.body.error).toBe('too_many_attempts');
  });

  it('expires codes after five minutes and uses each code once', async () => {
    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const code = sms.lastCode(phone)!;
    tick(301);
    const late = await http().post('/v1/auth/verify').send({ phone, code }).expect(410);
    expect(late.body.error).toBe('code_expired');

    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const fresh = sms.lastCode(phone)!;
    await http().post('/v1/auth/verify').send({ phone, code: fresh }).expect(200);
    await http().post('/v1/auth/verify').send({ phone, code: fresh }).expect(410);
  });

  it('only honours the newest code', async () => {
    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const old = sms.lastCode(phone)!;
    tick(61);
    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const latest = sms.lastCode(phone)!;
    if (old !== latest) {
      await http().post('/v1/auth/verify').send({ phone, code: old }).expect(401);
    }
    await http().post('/v1/auth/verify').send({ phone, code: latest }).expect(200);
  });

  it('makes you wait a minute between codes and caps codes per hour', async () => {
    await http().post('/v1/auth/code').send({ phone }).expect(200);
    const soon = await http().post('/v1/auth/code').send({ phone }).expect(429);
    expect(soon.body).toMatchObject({ error: 'too_many_codes', retryAfterSeconds: 60 });
    for (let i = 0; i < 4; i++) {
      tick(61);
      await http().post('/v1/auth/code').send({ phone }).expect(200);
    }
    tick(61);
    const capped = await http().post('/v1/auth/code').send({ phone }).expect(429);
    expect(capped.body.retryAfterSeconds).toBeGreaterThan(60);
    tick(3600);
    await http().post('/v1/auth/code').send({ phone }).expect(200);
  });

  it('signs out this device only', async () => {
    const a = await signIn();
    tick(61);
    const b = await signIn();
    await http().post('/v1/auth/sign-out').set(bearer(a.token)).expect(204);
    const gone = await http().get('/v1/me').set(bearer(a.token)).expect(401);
    expect(gone.body.error).toBe('signed_out');
    await http().get('/v1/me').set(bearer(b.token)).expect(200);
  });

  it('refuses unknown tokens and signed-out requests', async () => {
    await http()
      .get('/v1/me/wallet')
      .set(bearer('x'.repeat(43)))
      .expect(401);
    const res = await http().get('/v1/me/wallet').expect(401);
    expect(res.body.error).toBe('signed_out');
  });

  it('ends sessions after 90 days', async () => {
    const { token } = await signIn();
    tick(90 * 24 * 3600 + 1);
    await http().get('/v1/me').set(bearer(token)).expect(401);
  });

  it('never puts the code in a reply', async () => {
    const res = await http().post('/v1/auth/code').send({ phone }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(sms.lastCode(phone)!);
  });

  it('ignores x-user-id outside development', async () => {
    await http().get('/v1/me/wallet').set({ 'x-user-id': 'dev-player' }).expect(200);
    process.env.AUTH_MODE = 'none';
    try {
      await http().get('/v1/me/wallet').set({ 'x-user-id': 'dev-player' }).expect(401);
    } finally {
      delete process.env.AUTH_MODE;
    }
  });
});

describe('sign-in configuration', () => {
  it('refuses to start production without a secret or a real SMS provider', async () => {
    const { loadConfig } = await import('../src/config');
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@localhost/db' }),
    ).toThrow(/AUTH_SECRET[\s\S]*SMS_PROVIDER/);
    expect(loadConfig({}).sms).toEqual({ provider: 'console' });
    expect(() => loadConfig({ SMS_PROVIDER: 'sslwireless' })).toThrow(/SSLWIRELESS_API_TOKEN/);
    expect(
      loadConfig({ SMS_PROVIDER: 'sslwireless', SSLWIRELESS_API_TOKEN: 't', SSLWIRELESS_SID: 's' })
        .sms,
    ).toMatchObject({ provider: 'sslwireless', apiToken: 't', sid: 's' });
  });
});
