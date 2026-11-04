import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// Gameweek 4 kicks off on 5 September.
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
  range: { floor: number; ceiling: number; maxWidth: number } | null;
  answer: unknown;
  result: unknown;
}

const answerFor = (call: Call) => {
  const value = call.options[0]?.value;
  switch (call.kind) {
    case 'outcome':
      return { kind: 'outcome', pick: 'home', confidence: 0.6 };
    case 'halfTimeLeader':
      return { kind: 'halfTimeLeader', pick: 'home' };
    case 'range':
      return { kind: 'range', min: call.range!.floor, max: call.range!.floor + 1 };
    case 'comparison':
      return { kind: 'comparison', pick: 'home' };
    case 'playerDuel':
      return { kind: 'playerDuel', pick: 'a' };
    default:
      return { kind: 'topPlayer', playerId: value };
  }
};
const answersOf = (calls: Call[]) => ({
  answers: calls.map((c) => ({ questionId: c.id, answer: answerFor(c) })),
});

beforeAll(async () => {
  app = await createApp({ feed, clock, logger: false, workerSeconds: 0 });
  await app.listen(0);
});
afterAll(async () => {
  await app.close();
});

describe('Season Mastery', () => {
  let cardId: string;
  let calls: Call[];

  it('makes one card of 5 to 8 calls per match, with no results before grading', async () => {
    const first = await http().get('/v1/mastery/cards?fixtureId=fx-4-1').expect(200);
    const again = await http().get('/v1/mastery/cards?fixtureId=fx-4-1').expect(200);
    expect(again.body.id).toBe(first.body.id);
    cardId = first.body.id;
    calls = first.body.calls;
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.length).toBeLessThanOrEqual(8);
    expect(first.body).toMatchObject({ status: 'open', score: null, rewardCoins: 15 });
    expect(calls.every((c) => c.answer === null && c.result === null)).toBe(true);
    await http().get('/v1/mastery/cards?fixtureId=nope').expect(404);
  });

  it('has no card for a match that started without one', async () => {
    const res = await http().get('/v1/mastery/cards?fixtureId=fx-1-1').expect(404);
    expect(res.body.error).toBe('no_card');
  });

  it('needs sign-in and a complete, valid submission', async () => {
    await http().put(`/v1/mastery/cards/${cardId}/answers`).send(answersOf(calls)).expect(401);
    const partial = await http()
      .put(`/v1/mastery/cards/${cardId}/answers`)
      .set(as('alice'))
      .send({ answers: answersOf(calls).answers.slice(1) })
      .expect(422);
    expect(partial.body.error).toBe('invalid_answers');
    await http()
      .put(`/v1/mastery/cards/${cardId}/answers`)
      .set(as('alice'))
      .send({ answers: [{ questionId: 'not-a-uuid', answer: { kind: 'nope' } }] })
      .expect(400);
  });

  it('pays the reward once, however many times a card is changed', async () => {
    const before = (await http().get('/v1/me/wallet').set(as('alice')).expect(200)).body.bonus;
    for (let i = 0; i < 2; i += 1) {
      const res = await http()
        .put(`/v1/mastery/cards/${cardId}/answers`)
        .set(as('alice'))
        .send(answersOf(calls))
        .expect(200);
      expect(res.body.calls.every((c: Call) => c.answer !== null)).toBe(true);
    }
    const after = (await http().get('/v1/me/wallet').set(as('alice')).expect(200)).body;
    expect(after.bonus).toBe(before + 15);
    expect(after.winnings).toBe(0);
  });

  it('shows a player only their own answers', async () => {
    const stranger = await http()
      .get('/v1/mastery/cards?fixtureId=fx-4-1')
      .set(as('bob'))
      .expect(200);
    expect(stranger.body.calls.every((c: Call) => c.answer === null)).toBe(true);
    const signedOut = await http().get('/v1/mastery/cards?fixtureId=fx-4-1').expect(200);
    expect(signedOut.body.submittedAt).toBeNull();
  });

  it('locks at kick-off by the clock, then grades after full time, once', async () => {
    await http()
      .put(`/v1/mastery/cards/${cardId}/answers`)
      .set(as('bob'))
      .send(answersOf(calls))
      .expect(200);

    const { kickoffAt } = (await http().get('/v1/fixtures/fx-4-1').expect(200)).body;
    now = new Date(kickoffAt);
    const locked = await http()
      .put(`/v1/mastery/cards/${cardId}/answers`)
      .set(as('alice'))
      .send(answersOf(calls))
      .expect(409);
    expect(locked.body.error).toBe('card_locked');
    const during = await http().get('/v1/mastery/cards?fixtureId=fx-4-1').expect(200);
    expect(during.body.status).toBe('locked');
    expect(during.body.calls.every((c: Call) => c.result === null)).toBe(true);

    now = new Date('2026-09-06T00:00:00Z');
    const graded = await http()
      .get('/v1/mastery/cards?fixtureId=fx-4-1')
      .set(as('alice'))
      .expect(200);
    expect(graded.body.status).toBe('graded');
    expect(graded.body.gradedVersion).toBe(1);
    expect(typeof graded.body.score).toBe('number');
    expect(graded.body.calls.every((c: Call) => c.result !== null)).toBe(true);

    const mine = await http().get('/v1/me/mastery').set(as('alice')).expect(200);
    const again = await http().get('/v1/me/mastery').set(as('alice')).expect(200);
    expect(mine.body.cardsCompleted).toBe(1);
    expect(again.body.cardsCompleted).toBe(1);
    expect(mine.body.tier).toBe('Scout');
    expect(mine.body.history).toEqual([
      expect.objectContaining({ fixtureId: 'fx-4-1', snapshotVersion: 1 }),
    ]);
    expect(mine.body.next).toMatchObject({ next: 'Analyst' });
  });

  it('keeps a leaderboard free of user ids, and only of players with enough cards', async () => {
    const res = await http().get('/v1/mastery/leaderboard').set(as('alice')).expect(200);
    expect(res.body.minCards).toBeGreaterThan(1);
    expect(res.body.entries).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('alice');
  });
});
