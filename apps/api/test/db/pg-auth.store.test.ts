import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OtpChallenge, SessionRecord } from '../../src/auth/auth.store';
import { PgAuthStore } from '../../src/auth/pg-auth.store';
import { createDatabase } from '../../src/db/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const store = new PgAuthStore(db);

const PHONE = '+8801712345678';
const OTHER = '+8801812345678';
const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 6, minute));

const challenge = (id: string, minute: number, over: Partial<OtpChallenge> = {}): OtpChallenge => ({
  id,
  phone: PHONE,
  codeHash: `hash-${id}`,
  createdAt: at(minute),
  expiresAt: at(minute + 5),
  attempts: 0,
  consumedAt: null,
  ...over,
});

const session = (tokenHash: string, userId = 'u-1'): SessionRecord => ({
  tokenHash,
  userId,
  createdAt: at(0),
  expiresAt: at(60),
  revokedAt: null,
});

// Only this file's tables, so the other database tests are left alone.
beforeEach(async () => {
  await db.execute(sql`truncate otp_challenge, phone_identity, auth_session, external_identity`);
});
afterAll(close);

describe('PgAuthStore codes', () => {
  it('lists recent codes newest first and finds the latest open one', async () => {
    await store.insertChallenge(challenge('c1', 0));
    await store.insertChallenge(challenge('c2', 10));
    await store.insertChallenge(challenge('c3', 20, { consumedAt: at(21) }));
    await store.insertChallenge(challenge('x1', 30, { phone: OTHER }));

    expect(await store.recentChallenges(PHONE, at(0))).toEqual([
      challenge('c3', 20, { consumedAt: at(21) }),
      challenge('c2', 10),
      challenge('c1', 0),
    ]);
    expect((await store.recentChallenges(PHONE, at(10))).map((c) => c.id)).toEqual(['c3', 'c2']);
    expect(await store.recentChallenges(PHONE, at(25))).toEqual([]);

    expect(await store.latestOpenChallenge(PHONE)).toEqual(challenge('c2', 10));
    expect(await store.latestOpenChallenge('+8801912345678')).toBeUndefined();
  });

  it('counts wrong guesses', async () => {
    await store.insertChallenge(challenge('c1', 0));
    expect(await store.recordFailedAttempt('c1')).toBe(1);
    expect(await store.recordFailedAttempt('c1')).toBe(2);
    const counts = await Promise.all([1, 2, 3].map(() => store.recordFailedAttempt('c1')));
    expect(counts.sort()).toEqual([3, 4, 5]);
    expect((await store.latestOpenChallenge(PHONE))?.attempts).toBe(5);
    expect(await store.recordFailedAttempt('missing')).toBe(0);
  });

  it('consumes a code only once, even when two requests race', async () => {
    await store.insertChallenge(challenge('c1', 0));
    const results = await Promise.all([
      store.consumeChallenge('c1', at(1), 5),
      store.consumeChallenge('c1', at(1), 5),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.consumeChallenge('c1', at(2), 5)).toBe(false);
    expect((await store.recentChallenges(PHONE, at(0)))[0]?.consumedAt).toEqual(at(1));
    expect(await store.latestOpenChallenge(PHONE)).toBeUndefined();
    expect(await store.consumeChallenge('missing', at(1), 5)).toBe(false);
  });

  it('refuses a code that has reached the wrong-guess limit', async () => {
    await store.insertChallenge(challenge('c1', 0));
    for (let i = 0; i < 3; i++) await store.recordFailedAttempt('c1');
    expect(await store.consumeChallenge('c1', at(1), 3)).toBe(false);
    expect(await store.consumeChallenge('c1', at(1), 4)).toBe(true);
  });
});

describe('PgAuthStore identities', () => {
  it('keeps the first player for a number when two first sign-ins race', async () => {
    const [a, b] = await Promise.all([
      store.createIdentity({ phone: PHONE, userId: 'u-a', createdAt: at(0) }),
      store.createIdentity({ phone: PHONE, userId: 'u-b', createdAt: at(0) }),
    ]);
    expect(a.userId).toBe(b.userId);
    expect(['u-a', 'u-b']).toContain(a.userId);
    expect(await store.findIdentity(PHONE)).toEqual(a);

    const again = await store.createIdentity({ phone: PHONE, userId: 'u-c', createdAt: at(5) });
    expect(again).toEqual(a);
  });

  it('finds an identity by number and by player', async () => {
    const stored = await store.createIdentity({ phone: PHONE, userId: 'u-1', createdAt: at(0) });
    expect(stored).toEqual({ phone: PHONE, userId: 'u-1', createdAt: at(0) });
    expect(await store.findIdentity(PHONE)).toEqual(stored);
    expect(await store.findIdentityByUser('u-1')).toEqual(stored);
    expect(await store.findIdentity(OTHER)).toBeUndefined();
    expect(await store.findIdentityByUser('u-2')).toBeUndefined();
  });
});

describe('PgAuthStore sessions', () => {
  it('stores, finds and revokes a session once', async () => {
    await store.insertSession(session('t1'));
    await store.insertSession(session('t2', 'u-2'));
    expect(await store.findSession('t1')).toEqual(session('t1'));
    expect(await store.findSession('missing')).toBeUndefined();

    await store.revokeSession('t1', at(10));
    expect(await store.findSession('t1')).toEqual({ ...session('t1'), revokedAt: at(10) });
    // A second revoke keeps the first time.
    await store.revokeSession('t1', at(20));
    expect((await store.findSession('t1'))?.revokedAt).toEqual(at(10));
    expect(await store.findSession('t2')).toEqual(session('t2', 'u-2'));
    await store.revokeSession('missing', at(10));
  });
});

describe('PgAuthStore Google accounts', () => {
  const google = (subject: string, userId: string, email: string | null = null) => ({
    provider: 'google' as const,
    subject,
    userId,
    email,
    createdAt: at(0),
  });

  it('links one Google account to one player, even when two first sign-ins race', async () => {
    const [a, b] = await Promise.all([
      store.createExternalIdentity(google('sub-1', 'u-a', 'a@gmail.com')),
      store.createExternalIdentity(google('sub-1', 'u-b', 'a@gmail.com')),
    ]);
    expect(a.userId).toBe(b.userId);
    expect(await store.findExternalIdentity('google', 'sub-1')).toMatchObject({
      userId: a.userId,
      email: 'a@gmail.com',
    });
    expect(await store.findExternalIdentity('google', 'nobody')).toBeUndefined();
  });

  it('finds the account by player and updates its email', async () => {
    await store.createExternalIdentity(google('sub-2', 'u-2', 'old@gmail.com'));
    await store.updateExternalEmail('google', 'sub-2', 'new@gmail.com');
    expect(await store.findExternalIdentityByUser('u-2')).toMatchObject({
      subject: 'sub-2',
      email: 'new@gmail.com',
    });
    expect(await store.findExternalIdentityByUser('u-none')).toBeUndefined();
  });
});
