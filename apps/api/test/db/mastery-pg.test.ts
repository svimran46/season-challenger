import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createDatabase } from '../../src/db/client';
import { FeedSync } from '../../src/feed/feed-sync';
import { MasteryService } from '../../src/mastery/mastery.service';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);

let now = new Date('2026-09-01T06:00:00Z');
const clock = () => now;
const feed = new FakeFeed({ seasonStart: '2026-08-15T14:00:00.000Z', now: clock });
let app: INestApplication;
const http = () => request(app.getHttpServer());
const as = (userId: string) => ({ 'x-user-id': userId });

interface Call {
  id: string;
  kind: string;
  options: { value: string }[];
  range: { floor: number } | null;
}
const answerFor = (c: Call) =>
  ({
    outcome: { kind: 'outcome', pick: 'home', confidence: 0.6 },
    halfTimeLeader: { kind: 'halfTimeLeader', pick: 'draw' },
    range: { kind: 'range', min: c.range?.floor, max: (c.range?.floor ?? 0) + 1 },
    comparison: { kind: 'comparison', pick: 'away' },
    playerDuel: { kind: 'playerDuel', pick: 'b' },
    topPlayer: { kind: 'topPlayer', playerId: c.options[0]?.value },
  })[c.kind];

beforeAll(async () => {
  await db.execute(
    sql`truncate analysis_card, question_template, mastery_match_score, mastery_season, card_answer, app_user, stats_snapshot, fixture, player, club, season, ledger_posting, ledger_balance, ledger_transaction cascade`,
  );
  await new FeedSync(db, feed).run();
  app = await createApp({ feed, clock, database: { db }, logger: false, workerSeconds: 0 });
  await app.listen(0);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Season Mastery on Postgres', () => {
  it('runs a card from submission to one grade, even with two graders at once', async () => {
    const cards = await Promise.all(
      [0, 1, 2].map(() => http().get('/v1/mastery/cards?fixtureId=fx-4-1').expect(200)),
    );
    expect(new Set(cards.map((c) => c.body.id)).size).toBe(1);
    const card = cards[0]!.body as { id: string; calls: Call[] };
    const body = { answers: card.calls.map((c) => ({ questionId: c.id, answer: answerFor(c) })) };

    for (const user of ['alice', 'bob']) {
      const [a, b] = await Promise.all([
        http().put(`/v1/mastery/cards/${card.id}/answers`).set(as(user)).send(body),
        http().put(`/v1/mastery/cards/${card.id}/answers`).set(as(user)).send(body),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
    }
    const wallet = await http().get('/v1/me/wallet').set(as('alice')).expect(200);
    expect(wallet.body.bonus).toBe(515);

    now = new Date('2026-09-06T00:00:00Z');
    await new FeedSync(db, feed).run();
    const mastery = app.get(MasteryService, { strict: false });
    await Promise.all([mastery.gradeFinished(), mastery.gradeFinished()]);

    const mine = await http().get('/v1/me/mastery').set(as('alice')).expect(200);
    expect(mine.body.cardsCompleted).toBe(1);
    expect(mine.body.history).toHaveLength(1);
    expect(mine.body.history[0]).toMatchObject({ fixtureId: 'fx-4-1', snapshotVersion: 1 });
    const seen = await http().get('/v1/mastery/cards?fixtureId=fx-4-1').set(as('bob')).expect(200);
    expect(seen.body.status).toBe('graded');
    expect(seen.body.calls.every((c: { result: unknown }) => c.result !== null)).toBe(true);
    expect(typeof seen.body.score).toBe('number');
    const scores = await db.execute(sql`select * from mastery_match_score`);
    expect(scores).toHaveLength(2);
  });
});
