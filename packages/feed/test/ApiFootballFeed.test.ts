import { describe, expect, it } from 'vitest';
import { DEFAULT_SQUAD_RULES, scorePlayer, validateSquad } from '@season/shared';
import { ApiFootballFeed, type FetchLike } from '../src';
import { gameweekOf, priceFor, statusOf } from '../src/api-football/ApiFootballFeed';

const HOME = 42; // Arsenal in the provider's ids
const AWAY = 49; // Chelsea
const KICKOFF = Date.parse('2026-09-12T14:00:00Z') / 1000;

/** Fourteen players a side, so a whole squad can be built in tests. */
const squad = (team: number) =>
  Array.from({ length: 14 }, (_, i) => ({
    id: team * 100 + i,
    name: `Player ${team}-${i}`,
    position: [
      'Goalkeeper',
      'Goalkeeper',
      ...Array(4).fill('Defender'),
      ...Array(4).fill('Midfielder'),
      ...Array(4).fill('Attacker'),
    ][i],
  }));

const fixtureRow = (id: number, status: string, round = 'Regular Season - 4') => ({
  fixture: { id, timestamp: KICKOFF, status: { short: status, elapsed: 90 } },
  league: { round },
  teams: { home: { id: HOME }, away: { id: AWAY } },
  goals: { home: 2, away: 1 },
});

const playerLine = (id: number, minutes: number, extra: Record<string, unknown> = {}) => ({
  player: { id },
  statistics: [
    {
      games: { minutes },
      goals: { total: 0, assists: 0, saves: 0, conceded: 0 },
      cards: { yellow: 0, red: 0 },
      tackles: { total: 1 },
      dribbles: { success: 0 },
      penalty: { saved: 0, missed: 0 },
      ...extra,
    },
  ],
});

const detail = {
  ...fixtureRow(1001, 'FT'),
  score: { halftime: { home: 1, away: 0 } },
  lineups: [
    {
      team: { id: HOME },
      startXI: [4200, 4202].map((id) => ({ player: { id } })),
      substitutes: [{ player: { id: 4203 } }],
    },
    {
      team: { id: AWAY },
      startXI: [4900, 4902].map((id) => ({ player: { id } })),
      substitutes: [{ player: { id: 4903 } }],
    },
  ],
  events: [
    {
      time: { elapsed: 20, extra: null },
      team: { id: HOME },
      player: { id: 4202 },
      assist: { id: null },
      type: 'Goal',
      detail: 'Normal Goal',
    },
    // Provider lists the player coming on first here: the adapter must work out who left.
    {
      time: { elapsed: 60, extra: null },
      team: { id: HOME },
      player: { id: 4203 },
      assist: { id: 4202 },
      type: 'subst',
      detail: 'Substitution 1',
    },
    {
      time: { elapsed: 70, extra: null },
      team: { id: AWAY },
      player: { id: 4902 },
      assist: null,
      type: 'Goal',
      detail: 'Own Goal',
    },
    {
      time: { elapsed: 80, extra: null },
      team: { id: AWAY },
      player: { id: 4902 },
      assist: null,
      type: 'Goal',
      detail: 'Normal Goal',
    },
    {
      time: { elapsed: 85, extra: null },
      team: { id: HOME },
      player: { id: 4203 },
      assist: null,
      type: 'Goal',
      detail: 'Normal Goal',
    },
    {
      time: { elapsed: 86, extra: null },
      team: { id: HOME },
      player: { id: 4203 },
      assist: null,
      type: 'Var',
      detail: 'Goal cancelled',
    },
  ],
  statistics: [
    {
      team: { id: HOME },
      statistics: [
        { type: 'Total Shots', value: 14 },
        { type: 'Shots on Goal', value: 6 },
        { type: 'Ball Possession', value: '58%' },
        { type: 'Corner Kicks', value: 7 },
      ],
    },
    {
      team: { id: AWAY },
      statistics: [
        { type: 'Total Shots', value: 9 },
        { type: 'Shots on Goal', value: null },
        { type: 'Ball Possession', value: '42%' },
        { type: 'Corner Kicks', value: 3 },
      ],
    },
  ],
  players: [
    {
      team: { id: HOME },
      players: [
        playerLine(4200, 90, { goals: { total: 0, assists: 0, saves: 3, conceded: 1 } }),
        playerLine(4202, 60, { goals: { total: 1, assists: 0, saves: 0, conceded: 0 } }),
        playerLine(4203, 30),
      ],
    },
    {
      team: { id: AWAY },
      players: [
        playerLine(4900, 90),
        playerLine(4902, 90, { goals: { total: 1, assists: 0, saves: 0, conceded: 0 } }),
      ],
    },
  ],
};

function stubProvider(now: () => Date) {
  const calls: string[] = [];
  const routes: Record<string, (q: URLSearchParams) => unknown> = {
    '/leagues': () => [
      {
        league: { id: 39, name: 'Premier League' },
        seasons: [{ year: 2026, start: '2026-08-22', end: '2027-05-30', current: true }],
      },
    ],
    '/teams': () => [
      { team: { id: HOME, name: 'Arsenal', code: 'ARS' } },
      { team: { id: AWAY, name: 'Chelsea', code: null } },
    ],
    '/players/squads': (q) => [
      { team: { id: Number(q.get('team')) }, players: squad(Number(q.get('team'))) },
    ],
    '/players': (q) =>
      Number(q.get('team')) === HOME
        ? [{ player: { id: 4210 }, statistics: [{ games: { minutes: 2700, rating: '7.80' } }] }]
        : [],
    '/fixtures': (q) =>
      q.get('id')
        ? [detail]
        : [
            fixtureRow(1001, 'FT'),
            fixtureRow(1002, 'NS', 'Regular Season - 38'),
            fixtureRow(1003, 'PST'),
          ],
  };
  const fetch: FetchLike = async (url, init) => {
    expect(init.headers['x-apisports-key']).toBe('test-key');
    const parsed = new URL(url);
    calls.push(parsed.pathname + parsed.search);
    const response = routes[parsed.pathname]!(parsed.searchParams);
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'x-ratelimit-requests-remaining' ? '7400' : null) },
      json: async () => ({ errors: [], response, paging: { current: 1, total: 1 } }),
    };
  };
  const feed = new ApiFootballFeed({ apiKey: 'test-key', season: 2026, fetch, now });
  return { feed, calls };
}

describe('ApiFootballFeed', () => {
  let clock = new Date('2026-09-12T18:00:00Z');
  const now = () => clock;

  it('maps the season, clubs and fixtures with prefixed ids', async () => {
    const { feed } = stubProvider(now);
    const season = await feed.getSeason();
    expect(season).toEqual({
      id: 'af-39-2026',
      competition: 'Premier League',
      startsOn: '2026-08-22',
      endsOn: '2027-05-30',
      gameweeks: 38,
    });
    const clubs = await feed.listClubs();
    expect(clubs.map((c) => [c.id, c.shortName])).toEqual([
      ['af-t-42', 'ARS'],
      ['af-t-49', 'CHE'],
    ]);
    const fixtures = await feed.listFixtures();
    expect(fixtures.map((f) => [f.id, f.status, f.gameweek])).toEqual([
      ['af-f-1001', 'finished', 4],
      ['af-f-1002', 'scheduled', 38],
      ['af-f-1003', 'scheduled', 4],
    ]);
    expect(feed.remainingToday).toBe(7400);
  });

  it('prices players from last season and builds a valid squad', async () => {
    const { feed } = stubProvider(now);
    const players = await feed.listPlayers();
    expect(players).toHaveLength(28);
    expect(players.find((p) => p.id === 'af-p-4210')).toMatchObject({
      position: 'FWD',
      credits: 11,
    });
    expect(players.find((p) => p.id === 'af-p-4211')).toMatchObject({
      position: 'FWD',
      credits: 7,
    });
    const pick = (club: number, idx: number[]) => idx.map((i) => `af-p-${club * 100 + i}`);
    const ids = [...pick(HOME, [0, 2, 3, 4, 6, 7]), ...pick(AWAY, [2, 6, 7, 10, 11])];
    const result = validateSquad(
      { fixtureId: 'af-f-1002', playerIds: ids, captainId: ids[0]!, viceCaptainId: ids[1]! },
      players,
      DEFAULT_SQUAD_RULES,
    );
    expect(result.errors).toEqual([]);
  });

  it('turns a match into stats: conceded while on the pitch, own goals, VAR', async () => {
    const { feed } = stubProvider(now);
    const stats = (await feed.getStats('af-f-1001'))!;
    expect(stats.isFinal).toBe(true);
    expect(stats.home).toEqual({
      clubId: 'af-t-42',
      goals: 2,
      halfTimeGoals: 1,
      shots: 14,
      shotsOnTarget: 6,
      possession: 58,
      corners: 7,
    });
    expect(stats.away.shotsOnTarget).toBe(0);
    const by = (id: number) => stats.players.find((p) => p.playerId === `af-p-${id}`)!;
    // Home conceded once (80'), when 4202 had already gone off and 4203 was on.
    expect(by(4200).goalsConceded).toBe(1);
    expect(by(4202).goalsConceded).toBe(0);
    expect(by(4203).goalsConceded).toBe(1);
    // Away conceded at 20' and through the own goal at 70'; the 85' goal was cancelled.
    expect(by(4900).goalsConceded).toBe(2);
    expect(by(4902).ownGoals).toBe(1);
    expect(by(4200).saves).toBe(3);
    expect(scorePlayer('MID', by(4202)).points).toBeGreaterThan(0);
  });

  it('is not final until the stats have had time to settle', async () => {
    clock = new Date('2026-09-12T16:00:00Z');
    const { feed } = stubProvider(now);
    expect((await feed.getStats('af-f-1001'))!.isFinal).toBe(false);
    expect(await feed.getStats('fx-1-1')).toBeUndefined();
    clock = new Date('2026-09-12T18:00:00Z');
  });

  it('reuses answers instead of spending quota on every sync', async () => {
    const { feed, calls } = stubProvider(now);
    await feed.listPlayers();
    await feed.listPlayers();
    await feed.listFixtures();
    await feed.listFixtures();
    expect(calls.filter((c) => c.startsWith('/players/squads'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('/fixtures'))).toHaveLength(1);
  });

  it('raises the errors the provider sends with HTTP 200', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ errors: { token: 'Error/Missing application key.' }, response: [] }),
    });
    const feed = new ApiFootballFeed({ apiKey: 'bad', fetch });
    await expect(feed.listClubs()).rejects.toThrow('Missing application key');
  });
});

describe('API-Football mapping helpers', () => {
  it('reads gameweeks, statuses and prices', () => {
    expect(gameweekOf('Regular Season - 12')).toBe(12);
    expect(gameweekOf('Final')).toBe(0);
    expect(statusOf('HT')).toBe('live');
    expect(statusOf('PEN')).toBe('finished');
    expect(statusOf('CANC')).toBe('scheduled');
    expect(priceFor('FWD', undefined)).toBe(7);
    expect(priceFor('FWD', 9)).toBe(11);
    expect(priceFor('GK', 5)).toBe(4.5);
  });
});
