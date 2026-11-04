import type {
  Club,
  Fixture,
  FixtureStatus,
  Player,
  PlayerMatchStats,
  Position,
  Season,
  StatsSnapshot,
  TeamMatchStats,
} from '@season/shared';
import type { FixtureFilter, FootballFeed } from '../FootballFeed';
import type {
  AfEvent,
  AfFixture,
  AfFixtureDetail,
  AfLeague,
  AfPlayerSeason,
  AfSquad,
  AfTeam,
  AfTeamStatistics,
} from './types';

/** The parts of `fetch` the adapter uses, so tests can pass a stub. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface ApiFootballOptions {
  apiKey: string;
  /** API-Football league id. 39 is the English Premier League. */
  leagueId?: number;
  /** Season by its starting year: 2026 is the 2026/27 season. */
  season?: number;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => Date;
}

export const PREMIER_LEAGUE = 39;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long each kind of answer is reused before asking the provider again. */
const TTL = {
  league: 24 * HOUR,
  teams: 24 * HOUR,
  squads: 12 * HOUR,
  prices: 24 * HOUR,
  fixturesQuiet: 15 * MINUTE,
  fixturesMatchday: MINUTE,
  stats: 2 * MINUTE,
} as const;

/**
 * Stats keep being corrected for a while after full time, so a match is only final (and
 * tournaments only pay out) this long after kick-off.
 */
const FINAL_AFTER_KICKOFF = 3 * HOUR;

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FINISHED = new Set(['FT', 'AET', 'PEN']);

const POSITIONS: Record<string, Position> = {
  Goalkeeper: 'GK',
  Defender: 'DEF',
  Midfielder: 'MID',
  Attacker: 'FWD',
  G: 'GK',
  D: 'DEF',
  M: 'MID',
  F: 'FWD',
};

/** Price band per position; where a player sits in it comes from last season's rating. */
const CREDIT_RANGE: Record<Position, readonly [number, number]> = {
  GK: [4.5, 6],
  DEF: [4.5, 7],
  MID: [5, 10],
  FWD: [6, 11],
};
const RATING_FLOOR = 6.3;
const RATING_TOP = 7.6;

/** Kit colours are not in the feed; clubs get a stable colour from this palette instead. */
const PALETTE = [
  '#1d4ed8',
  '#b91c1c',
  '#15803d',
  '#7c3aed',
  '#ea580c',
  '#0f766e',
  '#334155',
  '#ca8a04',
  '#be185d',
  '#0369a1',
];

export class ApiFootballError extends Error {}

/**
 * Adapter for API-Football (api-sports.io, v3). One request per call where possible and a cache
 * per answer, so a 60-second sync stays far inside the paid plan's daily quota. Our ids are the
 * provider's ids with a prefix, so they never collide with the fake league's.
 */
export class ApiFootballFeed implements FootballFeed {
  readonly name = 'api-football';
  /** Requests left today, from the provider's last response. */
  remainingToday: number | undefined;

  private readonly leagueId: number;
  private readonly seasonYear: number;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly cache = new Map<string, { until: number; value: Promise<unknown> }>();

  constructor(private readonly options: ApiFootballOptions) {
    if (!options.apiKey) throw new ApiFootballError('API-Football needs an API key.');
    this.leagueId = options.leagueId ?? PREMIER_LEAGUE;
    this.seasonYear = options.season ?? new Date().getUTCFullYear();
    this.baseUrl = (options.baseUrl ?? 'https://v3.football.api-sports.io').replace(/\/$/, '');
    this.fetchFn = options.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
    this.now = options.now ?? (() => new Date());
  }

  get seasonId(): string {
    return `af-${this.leagueId}-${this.seasonYear}`;
  }

  async getSeason(): Promise<Season> {
    const [leagues, fixtures] = await Promise.all([
      this.cached('league', TTL.league, () =>
        this.get<AfLeague>('/leagues', { id: this.leagueId, season: this.seasonYear }),
      ),
      this.rawFixtures(),
    ]);
    const entry = leagues[0];
    const season = entry?.seasons.find((s) => s.year === this.seasonYear) ?? entry?.seasons[0];
    if (!entry || !season) {
      throw new ApiFootballError(
        `League ${this.leagueId} has no ${this.seasonYear} season on this API plan.`,
      );
    }
    return {
      id: this.seasonId,
      competition: entry.league.name,
      startsOn: season.start,
      endsOn: season.end,
      gameweeks: Math.max(0, ...fixtures.map((f) => gameweekOf(f.league.round))),
    };
  }

  async listClubs(): Promise<Club[]> {
    const teams = await this.teams();
    return teams.map(({ team }) => ({
      id: clubId(team.id),
      name: team.name,
      shortName: (team.code ?? team.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase(),
      colour: PALETTE[team.id % PALETTE.length]!,
    }));
  }

  async listPlayers(clubIds?: readonly string[]): Promise<Player[]> {
    const teams = (await this.teams()).filter(
      ({ team }) => !clubIds || clubIds.includes(clubId(team.id)),
    );
    const perTeam = await Promise.all(
      teams.map(async ({ team }) => {
        const [squads, ratings] = await Promise.all([
          this.cached(`squad:${team.id}`, TTL.squads, () =>
            this.get<AfSquad>('/players/squads', { team: team.id }),
          ),
          this.lastSeasonRatings(team.id),
        ]);
        return (squads[0]?.players ?? []).flatMap((p): Player[] => {
          const position = POSITIONS[p.position ?? ''];
          if (!position) return [];
          return [
            {
              id: playerId(p.id),
              clubId: clubId(team.id),
              name: p.name,
              position,
              credits: priceFor(position, ratings.get(p.id)),
            },
          ];
        });
      }),
    );
    return perTeam.flat();
  }

  async listFixtures(filter: FixtureFilter = {}): Promise<Fixture[]> {
    const fixtures = (await this.rawFixtures()).map((f) => this.toFixture(f));
    return fixtures
      .filter((f) => filter.gameweek === undefined || f.gameweek === filter.gameweek)
      .filter((f) => filter.status === undefined || f.status === filter.status)
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.id.localeCompare(b.id));
  }

  async getFixture(fixtureId: string): Promise<Fixture | undefined> {
    return (await this.listFixtures()).find((f) => f.id === fixtureId);
  }

  async getStats(fixtureId: string): Promise<StatsSnapshot | undefined> {
    const providerId = fromId('af-f-', fixtureId);
    if (providerId === undefined) return undefined;
    const fetchedAt = this.now().getTime();
    const [detail] = await this.cached(`stats:${providerId}`, TTL.stats, () =>
      this.get<AfFixtureDetail>('/fixtures', { id: providerId }),
    );
    if (!detail) return undefined;
    const status = statusOf(detail.fixture.status.short);
    if (status === 'scheduled') return undefined;
    const isFinal =
      status === 'finished' && fetchedAt - detail.fixture.timestamp * 1000 >= FINAL_AFTER_KICKOFF;
    return {
      fixtureId,
      // Seconds since the epoch: later fetches get higher versions; the sync skips repeats.
      version: Math.floor(fetchedAt / 1000),
      isFinal,
      home: teamStats(detail, 'home'),
      away: teamStats(detail, 'away'),
      players: playerStats(detail),
    };
  }

  private toFixture(f: AfFixture): Fixture {
    return {
      id: `af-f-${f.fixture.id}`,
      seasonId: this.seasonId,
      gameweek: gameweekOf(f.league.round),
      homeClubId: clubId(f.teams.home.id),
      awayClubId: clubId(f.teams.away.id),
      kickoffAt: new Date(f.fixture.timestamp * 1000).toISOString(),
      status: statusOf(f.fixture.status.short),
    };
  }

  private teams(): Promise<AfTeam[]> {
    return this.cached('teams', TTL.teams, () =>
      this.get<AfTeam>('/teams', { league: this.leagueId, season: this.seasonYear }),
    );
  }

  /** The whole season in one request; refreshed every minute around matches. */
  private async rawFixtures(): Promise<AfFixture[]> {
    const key = 'fixtures';
    const hit = this.cache.get(key);
    if (hit && hit.until > this.now().getTime()) return hit.value as Promise<AfFixture[]>;
    const value = this.get<AfFixture>('/fixtures', {
      league: this.leagueId,
      season: this.seasonYear,
    });
    this.cache.set(key, { until: Number.POSITIVE_INFINITY, value });
    try {
      const fixtures = await value;
      const ttl = this.isMatchday(fixtures) ? TTL.fixturesMatchday : TTL.fixturesQuiet;
      this.cache.set(key, { until: this.now().getTime() + ttl, value });
      return fixtures;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  /** A match is live, or one kicks off within the quiet refresh window. */
  private isMatchday(fixtures: AfFixture[]): boolean {
    const now = this.now().getTime();
    return fixtures.some((f) => {
      if (LIVE.has(f.fixture.status.short)) return true;
      const kickoff = f.fixture.timestamp * 1000;
      return kickoff - TTL.fixturesQuiet <= now && now <= kickoff + 3 * HOUR;
    });
  }

  /** Average match rating per player last season, used to price squads. */
  private lastSeasonRatings(teamId: number): Promise<Map<number, number>> {
    return this.cached(`prices:${teamId}`, TTL.prices, async () => {
      const ratings = new Map<number, number>();
      const params = { team: teamId, season: this.seasonYear - 1, league: this.leagueId };
      let page = 1;
      let total = 1;
      do {
        const body = await this.request<AfPlayerSeason>('/players', { ...params, page });
        total = Math.min(body.paging?.total ?? 1, 10);
        for (const { player, statistics } of body.response) {
          const rated = statistics
            .map((s) => ({ rating: Number(s.games.rating), minutes: s.games.minutes ?? 0 }))
            .filter((s) => Number.isFinite(s.rating) && s.rating > 0 && s.minutes > 0);
          const minutes = rated.reduce((sum, s) => sum + s.minutes, 0);
          // Fewer than five full matches is too little to judge; those players get the default.
          if (minutes >= 450) {
            ratings.set(
              player.id,
              rated.reduce((sum, s) => sum + s.rating * s.minutes, 0) / minutes,
            );
          }
        }
        page += 1;
      } while (page <= total);
      return ratings;
    });
  }

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const now = this.now().getTime();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { until: now + ttl, value });
    // A failed request is not cached: the next sync tick tries again.
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  private async get<T>(path: string, params: Record<string, string | number>): Promise<T[]> {
    return (await this.request<T>(path, params)).response;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<{ response: T[]; paging?: { current: number; total: number } }> {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const res = await this.fetchFn(`${this.baseUrl}${path}?${query}`, {
      headers: { 'x-apisports-key': this.options.apiKey },
    });
    const remaining = Number(res.headers.get('x-ratelimit-requests-remaining'));
    if (Number.isFinite(remaining) && res.headers.get('x-ratelimit-requests-remaining') !== null) {
      this.remainingToday = remaining;
    }
    if (!res.ok) throw new ApiFootballError(`API-Football ${path} answered HTTP ${res.status}.`);
    const body = (await res.json()) as {
      errors?: unknown;
      response?: T[];
      paging?: { current: number; total: number };
    };
    // Errors come back with HTTP 200, as an array or an object of messages.
    const errors: unknown[] = body.errors ? Object.values(body.errors as object) : [];
    if (errors.length > 0) {
      throw new ApiFootballError(`API-Football ${path}: ${errors.map(String).join('; ')}`);
    }
    return { response: body.response ?? [], paging: body.paging };
  }
}

const clubId = (id: number) => `af-t-${id}`;
const playerId = (id: number) => `af-p-${id}`;

function fromId(prefix: string, id: string): number | undefined {
  if (!id.startsWith(prefix)) return undefined;
  const n = Number(id.slice(prefix.length));
  return Number.isInteger(n) ? n : undefined;
}

/** "Regular Season - 12" is gameweek 12. Cup rounds without a number are gameweek 0. */
export function gameweekOf(round: string): number {
  const match = /(\d+)\s*$/.exec(round);
  return match ? Number(match[1]) : 0;
}

/**
 * Postponed, cancelled and abandoned matches stay scheduled: tournaments never lock or pay on
 * them, and a rescheduled match keeps its id with a new kick-off time.
 */
export function statusOf(short: string): FixtureStatus {
  if (LIVE.has(short)) return 'live';
  if (FINISHED.has(short)) return 'finished';
  return 'scheduled';
}

export function priceFor(position: Position, rating: number | undefined): number {
  const [lo, hi] = CREDIT_RANGE[position];
  if (rating === undefined) return lo + 1;
  const share = Math.min(1, Math.max(0, (rating - RATING_FLOOR) / (RATING_TOP - RATING_FLOOR)));
  return lo + Math.round((share * (hi - lo)) / 0.5) * 0.5;
}

function teamStats(detail: AfFixtureDetail, side: 'home' | 'away'): TeamMatchStats {
  const teamId = detail.teams[side].id;
  const stats = detail.statistics?.find((s) => s.team.id === teamId);
  return {
    clubId: clubId(teamId),
    goals: detail.goals[side] ?? 0,
    halfTimeGoals: detail.score.halftime[side] ?? 0,
    shots: stat(stats, 'Total Shots'),
    shotsOnTarget: stat(stats, 'Shots on Goal'),
    possession: stat(stats, 'Ball Possession'),
    corners: stat(stats, 'Corner Kicks'),
  };
}

function stat(stats: AfTeamStatistics | undefined, type: string): number {
  const value = stats?.statistics.find((s) => s.type === type)?.value;
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The provider's per-player numbers, plus two it does not give per player: own goals, and goals
 * conceded while each player was on the pitch (replayed from the match events).
 */
function playerStats(detail: AfFixtureDetail): PlayerMatchStats[] {
  const { conceded, ownGoals } = replayEvents(detail);
  return (detail.players ?? []).flatMap(({ players }) =>
    players.map(({ player, statistics }): PlayerMatchStats => {
      const s = statistics[0];
      return {
        playerId: playerId(player.id),
        minutes: s?.games.minutes ?? 0,
        goals: s?.goals.total ?? 0,
        assists: s?.goals.assists ?? 0,
        goalsConceded: conceded.get(player.id) ?? 0,
        saves: s?.goals.saves ?? 0,
        penaltiesSaved: s?.penalty.saved ?? 0,
        penaltiesMissed: s?.penalty.missed ?? 0,
        ownGoals: ownGoals.get(player.id) ?? 0,
        yellowCards: s?.cards.yellow ?? 0,
        redCards: s?.cards.red ?? 0,
        tackles: s?.tackles.total ?? 0,
        dribbles: s?.dribbles.success ?? 0,
      };
    }),
  );
}

export function replayEvents(detail: AfFixtureDetail): {
  conceded: Map<number, number>;
  ownGoals: Map<number, number>;
} {
  const teamOf = new Map<number, number>();
  const onPitch = new Set<number>();
  for (const lineup of detail.lineups ?? []) {
    for (const { player } of lineup.startXI) {
      teamOf.set(player.id, lineup.team.id);
      onPitch.add(player.id);
    }
    for (const { player } of lineup.substitutes) teamOf.set(player.id, lineup.team.id);
  }
  for (const group of detail.players ?? []) {
    for (const { player } of group.players) {
      if (!teamOf.has(player.id)) teamOf.set(player.id, group.team.id);
    }
  }
  const home = detail.teams.home.id;
  const away = detail.teams.away.id;
  const conceded = new Map<number, number>();
  const ownGoals = new Map<number, number>();
  const counted: { scorer: number | null; team: number; players: number[]; own: boolean }[] = [];
  const add = (map: Map<number, number>, id: number, by: number) =>
    map.set(id, (map.get(id) ?? 0) + by);

  const events = [...(detail.events ?? [])].sort(
    (a, b) => a.time.elapsed - b.time.elapsed || (a.time.extra ?? 0) - (b.time.extra ?? 0),
  );
  for (const event of events) {
    const scorer = event.player?.id ?? null;
    if (event.type === 'subst') {
      // Which of the two names is leaving differs between competitions; the one on the pitch is.
      const [out, inn] =
        scorer !== null && onPitch.has(scorer)
          ? [scorer, event.assist?.id]
          : [event.assist?.id, scorer];
      if (out != null) onPitch.delete(out);
      if (inn != null) onPitch.add(inn);
    } else if (event.type === 'Card' && /red/i.test(event.detail)) {
      if (scorer !== null) onPitch.delete(scorer);
    } else if (event.type === 'Goal' && event.detail !== 'Missed Penalty') {
      const own = event.detail === 'Own Goal';
      const scorerTeam = scorer !== null ? teamOf.get(scorer) : undefined;
      // An own goal is conceded by the scorer's own team; otherwise by the other team.
      const concedingTeam = own
        ? (scorerTeam ?? otherTeam(event, home, away))
        : scorerTeam !== undefined
          ? scorerTeam === home
            ? away
            : home
          : otherTeam(event, home, away);
      const players = [...onPitch].filter((id) => teamOf.get(id) === concedingTeam);
      for (const id of players) add(conceded, id, 1);
      if (own && scorer !== null) add(ownGoals, scorer, 1);
      counted.push({ scorer, team: concedingTeam, players, own });
    } else if (event.type === 'Var' && /goal (cancelled|disallowed)/i.test(event.detail)) {
      let index = counted.length - 1;
      while (index >= 0 && counted[index]!.scorer !== scorer) index -= 1;
      const goal = index >= 0 ? counted.splice(index, 1)[0] : undefined;
      if (goal) {
        for (const id of goal.players) add(conceded, id, -1);
        if (goal.own && goal.scorer !== null) add(ownGoals, goal.scorer, -1);
      }
    }
  }
  return { conceded, ownGoals };
}

function otherTeam(event: AfEvent, home: number, away: number): number {
  return event.team.id === home ? away : home;
}
