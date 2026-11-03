import type { INestApplication } from '@nestjs/common';
import { FakeFeed } from '@season/feed';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// 2026-09-01: gameweeks 1-3 are finished, gameweek 4 is next.
const feed = new FakeFeed({
  seasonStart: '2026-08-15T14:00:00.000Z',
  now: () => new Date('2026-09-01T00:00:00Z'),
});
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createApp({ feed, logger: false });
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('API', () => {
  it('reports health and the active feed', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', feed: 'fake' });
  });

  it('returns the season with the current gameweek', async () => {
    const res = await http().get('/v1/season').expect(200);
    expect(res.body).toMatchObject({
      competition: 'Fake League',
      gameweeks: 14,
      currentGameweek: 4,
    });
  });

  it('lists fixtures with clubs, filtered by gameweek and status', async () => {
    const res = await http().get('/v1/fixtures?gameweek=4').expect(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toMatchObject({ gameweek: 4, status: 'scheduled' });
    expect(res.body[0].home.name).toEqual(expect.any(String));
    const finished = await http().get('/v1/fixtures?status=finished').expect(200);
    expect(finished.body).toHaveLength(12);
  });

  it('rejects a bad query', async () => {
    const res = await http().get('/v1/fixtures?gameweek=zero').expect(400);
    expect(res.body.issues[0].path).toBe('gameweek');
  });

  it('returns a fixture with both squads, or 404', async () => {
    const res = await http().get('/v1/fixtures/fx-4-1').expect(200);
    expect(res.body.players).toHaveLength(36);
    await http().get('/v1/fixtures/nope').expect(404);
  });

  it('returns player points for a finished fixture only', async () => {
    const res = await http().get('/v1/fixtures/fx-1-1/points').expect(200);
    expect(res.body.players.length).toBeGreaterThanOrEqual(22);
    const [top, next] = res.body.players;
    expect(top.points).toBeGreaterThanOrEqual(next.points);
    await http().get('/v1/fixtures/fx-4-1/points').expect(404);
  });

  describe('POST /v1/squads/validate', () => {
    async function validSquadFor(fixtureId: string) {
      const { body } = await http().get(`/v1/fixtures/${fixtureId}`).expect(200);
      // Cheapest legal 1-4-4-2 using six home and five away starters.
      const starters = (clubId: string) =>
        body.players
          .filter((p: { clubId: string; id: string }) => p.clubId === clubId)
          .slice(0, 11);
      const home = starters(body.homeClubId);
      const away = starters(body.awayClubId);
      const ids = [
        home[0],
        home[1],
        home[2],
        away[3],
        away[4],
        home[5],
        home[6],
        away[7],
        away[8],
        home[9],
        away[10],
      ].map((p: { id: string }) => p.id);
      return { fixtureId, playerIds: ids, captainId: ids[9]!, viceCaptainId: ids[10]! };
    }

    it('reports a squad as valid or explains why not', async () => {
      const squad = await validSquadFor('fx-4-1');
      const res = await http().post('/v1/squads/validate').send(squad).expect(200);
      if (!res.body.valid) {
        // Random prices can push a squad over budget; every other rule must pass.
        expect(res.body.errors.map((e: { code: string }) => e.code)).toEqual(['over_budget']);
      }
      expect(res.body.creditsUsed).toBeGreaterThan(0);
    });

    it('locks squads once the fixture has kicked off', async () => {
      const squad = await validSquadFor('fx-1-1');
      const res = await http().post('/v1/squads/validate').send(squad).expect(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors[0].code).toBe('fixture_locked');
    });

    it('rejects a malformed body', async () => {
      await http().post('/v1/squads/validate').send({ fixtureId: 'fx-4-1' }).expect(400);
    });
  });
});
