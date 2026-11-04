import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedOffers } from '../src/economy/economy.module';
import { MemoryEconomyRepository } from '../src/economy/memory-economy.repository';
import { DEMO_OFFERS } from './demo-catalogue';

const now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
let app: INestApplication;

beforeAll(async () => {
  const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
  app = await createApp({ feed, clock, logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

describe('voucher catalogue', () => {
  it('is empty until real partners sign', async () => {
    const res = await request(app.getHttpServer()).get('/v1/vouchers/offers').expect(200);
    expect(res.body).toEqual([]);
  });

  it('retires placeholder offers stored by earlier builds, keeping their rows', async () => {
    const repo = new MemoryEconomyRepository();
    await repo.upsertOffers(DEMO_OFFERS);
    await seedOffers(repo, []);
    const offers = await repo.listOffers();
    expect(offers).toHaveLength(DEMO_OFFERS.length);
    expect(offers.every((o) => !o.active)).toBe(true);
  });

  it('keeps offers it is given active', async () => {
    const repo = new MemoryEconomyRepository();
    await seedOffers(repo, DEMO_OFFERS);
    await seedOffers(repo, DEMO_OFFERS);
    expect((await repo.listOffers()).every((o) => o.active)).toBe(true);
  });
});
