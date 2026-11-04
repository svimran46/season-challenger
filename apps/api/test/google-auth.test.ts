import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { GoogleProfile, GoogleVerifier } from '../src/auth/google';

const now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });

/** Accepts tokens shaped "good:<sub>:<email>" and rejects everything else, like Google would. */
class FakeGoogle implements GoogleVerifier {
  readonly webClientId = 'test-web.apps.googleusercontent.com';
  async verify(idToken: string): Promise<GoogleProfile> {
    const [kind, subject, email, verified] = idToken.split(':');
    if (kind !== 'good' || !subject) throw new Error('bad token');
    return { subject, email: email || null, emailVerified: verified !== 'unverified' };
  }
}

const tok = (sub: string, email = `${sub}@gmail.com`, extra = '') =>
  `good:${sub}:${email}${extra}`.padEnd(24, ':');

let app: INestApplication;
let phoneOff: INestApplication;
let noGoogle: INestApplication;
const http = (a = app) => request(a.getHttpServer());

beforeAll(async () => {
  app = await createApp({ feed, clock, auth: { google: new FakeGoogle() }, logger: false });
  phoneOff = await createApp({
    feed,
    clock,
    auth: { google: new FakeGoogle(), settings: { phoneEnabled: false } },
    logger: false,
  });
  noGoogle = await createApp({ feed, clock, logger: false });
  await Promise.all([app.init(), phoneOff.init(), noGoogle.init()]);
});
afterAll(async () => {
  await Promise.all([app.close(), phoneOff.close(), noGoogle.close()]);
});

describe('Google sign-in', () => {
  it('lists the sign-in methods the server offers', async () => {
    expect((await http().get('/v1/auth/methods').expect(200)).body).toEqual({
      phone: true,
      google: { webClientId: 'test-web.apps.googleusercontent.com' },
    });
    expect((await http(phoneOff).get('/v1/auth/methods').expect(200)).body.phone).toBe(false);
    expect((await http(noGoogle).get('/v1/auth/methods').expect(200)).body.google).toBeNull();
  });

  it('creates a player on first sign-in and returns the same one after', async () => {
    const first = await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-1') })
      .expect(200);
    expect(first.body.user).toMatchObject({
      id: expect.stringMatching(/^u_/),
      email: 'g-1@gmail.com',
      phone: null,
      isNew: true,
    });
    const again = await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-1') })
      .expect(200);
    expect(again.body.user).toMatchObject({ id: first.body.user.id, isNew: false });

    const auth = { authorization: `Bearer ${first.body.token}` };
    expect((await http().get('/v1/me').set(auth).expect(200)).body).toEqual({
      id: first.body.user.id,
      phone: null,
      email: 'g-1@gmail.com',
    });
    expect((await http().get('/v1/me/wallet').set(auth).expect(200)).body.bonus).toBe(500);
  });

  it('gives different Google accounts different players', async () => {
    const a = await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-a') })
      .expect(200);
    const b = await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-b') })
      .expect(200);
    expect(a.body.user.id).not.toBe(b.body.user.id);
  });

  it('keeps the email up to date and hides unverified ones', async () => {
    await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-mail') })
      .expect(200);
    const res = await http()
      .post('/v1/auth/google')
      .send({ idToken: tok('g-mail', 'new@gmail.com', ':unverified') })
      .expect(200);
    expect(res.body.user.email).toBeNull();
    const me = await http()
      .get('/v1/me')
      .set({ authorization: `Bearer ${res.body.token}` })
      .expect(200);
    expect(me.body.email).toBeNull();
  });

  it('rejects tokens Google would not accept', async () => {
    const res = await http()
      .post('/v1/auth/google')
      .send({ idToken: 'forged-token-forged-token' })
      .expect(401);
    expect(res.body.error).toBe('google_rejected');
  });

  it('says so when Google sign-in is not set up', async () => {
    const res = await http(noGoogle)
      .post('/v1/auth/google')
      .send({ idToken: tok('g-x') })
      .expect(503);
    expect(res.body.error).toBe('google_unavailable');
  });

  it('refuses phone codes when the server cannot send texts', async () => {
    const res = await http(phoneOff)
      .post('/v1/auth/code')
      .send({ phone: '01712345678' })
      .expect(503);
    expect(res.body.error).toBe('phone_unavailable');
  });
});
