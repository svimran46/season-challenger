import { NotFoundException, type INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MeController } from '../src/economy/me.controller';
import { DEV_KYC_KEY } from '../src/kyc/kyc.module';
import { KycService, sniffImage } from '../src/kyc/kyc.service';
import { EncryptedVault, MemoryBlobBackend } from '../src/kyc/vault';

let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
const backend = new MemoryBlobBackend();
const vault = new EncryptedVault(backend, DEV_KYC_KEY, 'memory');
const REVIEWER = 'reviewer-token-for-tests-0123456789';
let app: INestApplication;
const http = () => request(app.getHttpServer());
const as = (userId: string) => ({ 'x-user-id': userId });
const reviewer = { 'x-reviewer-token': REVIEWER };

// Smallest files the sniffer accepts, plus padding so they look like photos.
const jpeg = (fill = 1) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, fill)]);
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

beforeAll(async () => {
  app = await createApp({
    feed,
    clock,
    logger: false,
    workerSeconds: 0,
    kyc: { vault, settings: { reviewerToken: REVIEWER, retentionDays: 30 } },
  });
  await app.listen(0);
});
afterAll(async () => {
  await app.close();
});

function upload(
  userId: string,
  fields: Record<string, string>,
  files: Record<string, Buffer | undefined>,
) {
  let req = http().post('/v1/me/verification/documents').set(as(userId));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  for (const [k, v] of Object.entries(files)) {
    if (v) req = req.attach(k, v, { filename: `${k}.jpg`, contentType: 'image/jpeg' });
  }
  return req;
}

const nid = { documentType: 'nid', layout: 'front_back', birthDate: '1998-05-10' };

describe('ID document upload', () => {
  it('starts unverified and needs sign-in', async () => {
    await http().get('/v1/me/verification').expect(401);
    const res = await http().get('/v1/me/verification').set(as('kyc-amy')).expect(200);
    expect(res.body).toEqual({ status: 'unverified', verifiedAt: null, submission: null });
  });

  it('takes the national ID front and back, encrypted, and waits for review', async () => {
    const res = await upload(
      'kyc-amy',
      { ...nid, documentNumber: '1990 2612 3456' },
      { front: jpeg(1), back: jpeg(2) },
    ).expect(201);
    expect(res.body).toMatchObject({
      status: 'pending',
      verifiedAt: null,
      submission: { documentType: 'nid', layout: 'front_back', rejectionReason: null },
    });
    // Stored bytes are not the photo, and the photo is not readable without the key.
    const id = res.body.submission.id as string;
    const raw = backend.raw(`${id}-front`)!;
    expect(raw.includes(jpeg(1).subarray(4, 64))).toBe(false);
    expect((await vault.get(`${id}-front`))!.data.equals(jpeg(1))).toBe(true);

    const again = await upload(
      'kyc-amy',
      { ...nid, documentNumber: '1990 2612 3456' },
      { front: jpeg(), back: jpeg() },
    ).expect(409);
    expect(again.body.error).toBe('review_pending');

    // Still not verified: vouchers need the review to pass.
    const wallet = await http().get('/v1/me/wallet').set(as('kyc-amy')).expect(200);
    expect(wallet.body.verified).toBe(false);
  });

  it('checks the photos match the layout and are real images', async () => {
    const missing = await upload(
      'kyc-ben',
      { ...nid, documentNumber: 'NID-BEN-0001' },
      { front: jpeg() },
    ).expect(400);
    expect(missing.body.error).toBe('missing_image');
    const extra = await upload(
      'kyc-ben',
      { ...nid, layout: 'single', documentNumber: 'NID-BEN-0001' },
      { single: jpeg(), front: jpeg() },
    ).expect(400);
    expect(extra.body.error).toBe('bad_image');
    const notImage = await upload(
      'kyc-ben',
      { ...nid, documentNumber: 'NID-BEN-0001' },
      { front: jpeg(), back: Buffer.from('%PDF-1.7 not a photo') },
    ).expect(400);
    expect(notImage.body.error).toBe('bad_image');
    await upload(
      'kyc-ben',
      { ...nid, documentType: 'licence', documentNumber: 'NID-BEN-0001' },
      { front: jpeg(), back: jpeg() },
    ).expect(400);
    const young = await upload(
      'kyc-ben',
      { ...nid, birthDate: '2010-01-01', documentNumber: 'NID-BEN-0001' },
      { front: jpeg(), back: jpeg() },
    ).expect(422);
    expect(young.body.error).toBe('under_18');
    // Nothing was kept from the refused uploads.
    expect(backend.size()).toBe(2);
  });

  it('takes a passport in a single photo', async () => {
    const res = await http()
      .post('/v1/me/verification/documents')
      .set(as('kyc-cat'))
      .field('documentType', 'passport')
      .field('layout', 'single')
      .field('birthDate', '1995-12-31')
      .field('documentNumber', 'A01234567')
      .attach('single', png(), { filename: 'passport.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.submission).toMatchObject({ documentType: 'passport', layout: 'single' });
  });

  it('keeps the review routes behind the reviewer token', async () => {
    await http().get('/v1/review/verifications').expect(401);
    await http().get('/v1/review/verifications').set({ 'x-reviewer-token': 'wrong' }).expect(401);
    await http().get('/v1/review/verifications').set(as('kyc-amy')).expect(401);
    const page = await http().get('/review').expect(200);
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('lets a reviewer see the queue, the typed details and the photos', async () => {
    const queue = await http().get('/v1/review/verifications').set(reviewer).expect(200);
    expect(queue.body.map((s: { userId: string }) => s.userId)).toEqual(['kyc-amy', 'kyc-cat']);
    const amy = queue.body[0];
    expect(amy).toMatchObject({
      documentNumber: '1990 2612 3456',
      age: 28,
      birthDate: '1998-05-10',
    });
    const photo = await http()
      .get(`/v1/review/verifications/${amy.id}/images/back`)
      .set(reviewer)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect((photo.body as Buffer).equals(jpeg(2))).toBe(true);
    await http().get(`/v1/review/verifications/${amy.id}/images/single`).set(reviewer).expect(404);
  });

  it('approves: the player is verified and the typed number is wiped', async () => {
    const [amy] = (await http().get('/v1/review/verifications').set(reviewer)).body;
    const res = await http()
      .post(`/v1/review/verifications/${amy.id}/approve`)
      .set(reviewer)
      .send({ reviewer: 'MJ' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'approved', reviewedBy: 'MJ', documentNumber: null });
    const status = await http().get('/v1/me/verification').set(as('kyc-amy')).expect(200);
    expect(status.body).toMatchObject({ status: 'approved', verifiedAt: now.toISOString() });
    const wallet = await http().get('/v1/me/wallet').set(as('kyc-amy')).expect(200);
    expect(wallet.body.verified).toBe(true);

    const twice = await http()
      .post(`/v1/review/verifications/${amy.id}/approve`)
      .set(reviewer)
      .send({ reviewer: 'MJ' })
      .expect(409);
    expect(twice.body.error).toBe('already_decided');
    const more = await upload(
      'kyc-amy',
      { ...nid, documentNumber: '1990 2612 3456' },
      { front: jpeg(), back: jpeg() },
    ).expect(409);
    expect(more.body.error).toBe('already_verified');
  });

  it('refuses an ID that already verifies another account', async () => {
    const res = await upload(
      'kyc-dan',
      { ...nid, documentNumber: '19902612 3456' },
      { front: jpeg(), back: jpeg() },
    ).expect(409);
    expect(res.body.error).toBe('identity_in_use');
  });

  it('rejects with a reason, and the player can send new photos', async () => {
    const [cat] = (await http().get('/v1/review/verifications').set(reviewer)).body;
    await http()
      .post(`/v1/review/verifications/${cat.id}/reject`)
      .set(reviewer)
      .send({ reviewer: 'MJ', reason: 'Photo is blurry' })
      .expect(200);
    const status = await http().get('/v1/me/verification').set(as('kyc-cat')).expect(200);
    expect(status.body).toMatchObject({
      status: 'rejected',
      submission: { rejectionReason: 'Photo is blurry' },
    });
    await http()
      .post('/v1/me/verification/documents')
      .set(as('kyc-cat'))
      .field('documentType', 'passport')
      .field('layout', 'front_back')
      .field('birthDate', '1995-12-31')
      .field('documentNumber', 'A01234567')
      .attach('front', jpeg(), 'front.jpg')
      .attach('back', jpeg(), 'back.jpg')
      .expect(201);
    const history = await http()
      .get('/v1/review/verifications?status=rejected')
      .set(reviewer)
      .expect(200);
    expect(history.body).toHaveLength(1);
  });

  it('deletes photos once the retention period after the decision is over', async () => {
    const service = app.get(KycService);
    expect(await service.purgeExpired()).toBe(0);
    now = new Date(now.getTime() + 31 * 86_400_000);
    // Amy (approved) and Cat's first try (rejected); Cat's new photos are still pending.
    expect(await service.purgeExpired()).toBe(2);
    expect(backend.size()).toBe(2);
    const [amy] = (await http().get('/v1/review/verifications?status=approved').set(reviewer)).body;
    expect(amy).toMatchObject({ images: [] });
    expect(amy.imagesPurgedAt).not.toBeNull();
    await http().get(`/v1/review/verifications/${amy.id}/images/front`).set(reviewer).expect(404);
    // The player stays verified.
    const wallet = await http().get('/v1/me/wallet').set(as('kyc-amy')).expect(200);
    expect(wallet.body.verified).toBe(true);
  });
});

describe('instant verify shortcut', () => {
  it('answers 404 outside development, even for a signed-in player', async () => {
    const me = app.get(MeController);
    const body = { birthDate: '1990-01-01', documentNumber: 'SHORTCUT-001' };
    process.env.AUTH_MODE = 'none';
    try {
      expect(() => me.verify('kyc-eve', body)).toThrow(NotFoundException);
    } finally {
      delete process.env.AUTH_MODE;
    }
    await expect(me.verify('kyc-eve', body)).resolves.toMatchObject({ verified: true });
  });
});

describe('sniffImage', () => {
  it('knows phone photo formats by their first bytes', () => {
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(png())).toBe('image/png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(sniffImage(webp)).toBe('image/webp');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic')]);
    expect(sniffImage(heic)).toBe('image/heic');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeUndefined();
  });
});

describe('ID check configuration', () => {
  it('refuses to start production without the ID keys and photo storage', async () => {
    const { loadConfig } = await import('../src/config');
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x@localhost/db',
      AUTH_SECRET: 'x'.repeat(32),
      GOOGLE_WEB_CLIENT_ID: 'abc.apps.googleusercontent.com',
    };
    expect(() => loadConfig(prod)).toThrow(
      /ID_HASH_SECRET[\s\S]*KYC_ENCRYPTION_KEY[\s\S]*KYC_STORAGE_DIR/,
    );
    const key = Buffer.alloc(32, 7).toString('base64');
    const ok = loadConfig({
      ...prod,
      ID_HASH_SECRET: 'y'.repeat(32),
      KYC_ENCRYPTION_KEY: key,
      KYC_STORAGE_DIR: '/var/lib/season/kyc',
    });
    expect(ok.kyc).toMatchObject({ storageDir: '/var/lib/season/kyc', retentionDays: 90 });
    expect(ok.kyc.encryptionKey?.length).toBe(32);
    expect(() => loadConfig({ KYC_ENCRYPTION_KEY: 'too-short' })).toThrow(/KYC_ENCRYPTION_KEY/);
  });
});
