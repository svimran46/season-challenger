import { describe, expect, it } from 'vitest';
import { DEFAULT_SQUAD_RULES, scorePlayer } from '@season/shared';
import { FakeFeed, defaultSeasonStart } from '../src';

const at = (iso: string) => () => new Date(iso);
const seasonStart = '2026-08-15T14:00:00.000Z';

describe('FakeFeed', () => {
  const feed = new FakeFeed({ seasonStart, now: at('2026-09-01T00:00:00Z') });

  it('generates 8 clubs with 18 players each', async () => {
    const clubs = await feed.listClubs();
    expect(clubs).toHaveLength(8);
    const players = await feed.listPlayers();
    expect(players).toHaveLength(8 * 18);
    for (const club of clubs) {
      const squad = players.filter((p) => p.clubId === club.id);
      expect(squad.filter((p) => p.position === 'GK')).toHaveLength(2);
    }
  });

  it('prices players inside each position range', async () => {
    for (const p of await feed.listPlayers()) {
      expect(p.credits).toBeGreaterThanOrEqual(4.5);
      expect(p.credits).toBeLessThanOrEqual(11);
      expect((p.credits * 2) % 1).toBe(0);
    }
  });

  it('is deterministic for a seed', async () => {
    const again = new FakeFeed({ seasonStart, now: at('2026-09-01T00:00:00Z') });
    expect(await again.listPlayers()).toEqual(await feed.listPlayers());
    expect(await again.getStats('fx-1-1')).toEqual(await feed.getStats('fx-1-1'));
    const other = new FakeFeed({ seasonStart, seed: 7 });
    expect(await other.listPlayers()).not.toEqual(await feed.listPlayers());
  });

  it('builds a double round-robin where every club plays once per gameweek', async () => {
    const fixtures = await feed.listFixtures();
    expect(fixtures).toHaveLength(14 * 4);
    for (let gw = 1; gw <= 14; gw += 1) {
      const clubs = fixtures
        .filter((f) => f.gameweek === gw)
        .flatMap((f) => [f.homeClubId, f.awayClubId]);
      expect(new Set(clubs).size).toBe(8);
    }
    const pairs = fixtures.map((f) => `${f.homeClubId}>${f.awayClubId}`);
    expect(new Set(pairs).size).toBe(56);
  });

  it('starts the default season on a Saturday five weeks before now', () => {
    expect(defaultSeasonStart(new Date('2026-11-03T18:00:00Z'))).toBe('2026-09-26T14:00:00.000Z');
    expect(defaultSeasonStart(new Date('2026-11-07T10:00:00Z'))).toBe('2026-10-03T14:00:00.000Z');
  });

  it('derives status from the clock', async () => {
    const live = new FakeFeed({ seasonStart, now: at('2026-08-15T14:30:00Z') });
    expect((await live.getFixture('fx-1-1'))?.status).toBe('live');
    expect((await live.getFixture('fx-2-1'))?.status).toBe('scheduled');
    expect(await live.getStats('fx-1-1')).toBeUndefined();
    expect((await feed.listFixtures({ status: 'finished' })).every((f) => f.gameweek <= 3)).toBe(
      true,
    );
  });

  it('produces consistent stats for a finished fixture', async () => {
    for (const fixture of await feed.listFixtures({ status: 'finished' })) {
      const s = (await feed.getStats(fixture.id))!;
      expect(s.home.possession + s.away.possession).toBe(100);
      for (const t of [s.home, s.away]) {
        expect(t.halfTimeGoals).toBeLessThanOrEqual(t.goals);
        expect(t.shotsOnTarget).toBeGreaterThanOrEqual(t.goals);
        expect(t.shots).toBeGreaterThanOrEqual(t.shotsOnTarget);
      }
      const goalsFor = (clubId: string) =>
        s.players
          .filter((p) => p.playerId.startsWith(`${clubId}-`))
          .reduce((sum, p) => sum + p.goals, 0);
      expect(goalsFor(s.home.clubId)).toBe(s.home.goals);
      expect(goalsFor(s.away.clubId)).toBe(s.away.goals);
      expect(s.players.filter((p) => p.minutes > 0).length).toBeGreaterThanOrEqual(22);
    }
  });

  it('feeds the shared points rules', async () => {
    const players = await feed.listPlayers();
    const s = (await feed.getStats('fx-1-1'))!;
    const total = s.players.reduce((sum, ps) => {
      const position = players.find((p) => p.id === ps.playerId)!.position;
      return sum + scorePlayer(position, ps).points;
    }, 0);
    expect(total).toBeGreaterThan(0);
    expect(DEFAULT_SQUAD_RULES.size).toBe(11);
  });
});
