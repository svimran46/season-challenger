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
import { createRandom, hashString, type Random } from './random';

/** Fictional clubs, so local development needs no licensed data. */
const CLUBS: readonly Omit<Club, 'id'>[] = [
  { name: 'Harbour City', shortName: 'HBC', colour: '#1d4ed8' },
  { name: 'Northgate Rovers', shortName: 'NGR', colour: '#b91c1c' },
  { name: 'Ashford Athletic', shortName: 'ASH', colour: '#15803d' },
  { name: 'Riverside United', shortName: 'RVU', colour: '#7c3aed' },
  { name: 'Kingsbridge FC', shortName: 'KBR', colour: '#ea580c' },
  { name: 'Elmwood Wanderers', shortName: 'ELM', colour: '#0f766e' },
  { name: 'Stonebay Albion', shortName: 'STB', colour: '#334155' },
  { name: 'Westvale Town', shortName: 'WVT', colour: '#ca8a04' },
];

const FIRST_NAMES = [
  'Arlo',
  'Bram',
  'Caius',
  'Dario',
  'Emeka',
  'Finn',
  'Gael',
  'Hugo',
  'Idris',
  'Jonas',
  'Kofi',
  'Luca',
  'Mateo',
  'Niko',
  'Omar',
  'Pavel',
  'Rafa',
  'Soren',
  'Tariq',
  'Yusuf',
];
const LAST_NAMES = [
  'Abara',
  'Brennan',
  'Castell',
  'Duarte',
  'Eklund',
  'Ferro',
  'Galvin',
  'Haddad',
  'Ivers',
  'Jansen',
  'Kovac',
  'Lindqvist',
  'Moreau',
  'Nwosu',
  'Okafor',
  'Pereira',
  'Quinlan',
  'Rossi',
  'Sato',
  'Varga',
];

/** 18-player squads. The first 11 (1-4-4-2) start every match. */
const SQUAD_SHAPE: readonly Position[] = [
  'GK',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'MID',
  'MID',
  'MID',
  'MID',
  'FWD',
  'FWD',
  'GK',
  'DEF',
  'DEF',
  'MID',
  'MID',
  'FWD',
  'FWD',
];
const STARTERS = 11;

const CREDIT_RANGE: Record<Position, readonly [number, number]> = {
  GK: [4.5, 6],
  DEF: [4.5, 7],
  MID: [5, 10],
  FWD: [6, 11],
};

const MATCH_LENGTH_MS = 2 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface FakeFeedOptions {
  seed?: number;
  /** First kickoff, ISO. Later gameweeks are one week apart. */
  seasonStart?: string;
  gameweeks?: number;
  /** Clock used to decide fixture status. Inject a fixed time in tests. */
  now?: () => Date;
}

/**
 * A deterministic, offline football feed. Same seed, same league: clubs, players, fixtures
 * and match stats are generated, never fetched.
 */
export class FakeFeed implements FootballFeed {
  readonly name = 'fake';
  private readonly seed: number;
  private readonly now: () => Date;
  private readonly season: Season;
  private readonly clubs: Club[];
  private readonly players: Player[];
  private readonly fixtures: Omit<Fixture, 'status'>[];

  constructor(options: FakeFeedOptions = {}) {
    this.seed = options.seed ?? 2026;
    this.now = options.now ?? (() => new Date());
    const start = options.seasonStart ?? '2026-08-15T14:00:00.000Z';
    const gameweeks = options.gameweeks ?? (CLUBS.length - 1) * 2;
    const random = createRandom(this.seed);

    this.clubs = CLUBS.map((club, i) => ({ id: `club-${i + 1}`, ...club }));
    this.players = this.clubs.flatMap((club) => this.makeSquad(club, random));
    this.fixtures = this.makeFixtures(start, gameweeks);
    const last = this.fixtures.at(-1)?.kickoffAt ?? start;
    this.season = {
      id: 'season-fake-2026',
      competition: 'Fake League',
      startsOn: start.slice(0, 10),
      endsOn: last.slice(0, 10),
      gameweeks,
    };
  }

  async getSeason(): Promise<Season> {
    return this.season;
  }

  async listClubs(): Promise<Club[]> {
    return this.clubs;
  }

  async listPlayers(clubIds?: readonly string[]): Promise<Player[]> {
    if (!clubIds) return this.players;
    return this.players.filter((p) => clubIds.includes(p.clubId));
  }

  async listFixtures(filter: FixtureFilter = {}): Promise<Fixture[]> {
    return this.fixtures
      .map((f) => ({ ...f, status: this.statusOf(f.kickoffAt) }))
      .filter((f) => filter.gameweek === undefined || f.gameweek === filter.gameweek)
      .filter((f) => filter.status === undefined || f.status === filter.status);
  }

  async getFixture(fixtureId: string): Promise<Fixture | undefined> {
    const f = this.fixtures.find((x) => x.id === fixtureId);
    return f && { ...f, status: this.statusOf(f.kickoffAt) };
  }

  async getStats(fixtureId: string): Promise<StatsSnapshot | undefined> {
    const fixture = await this.getFixture(fixtureId);
    if (!fixture || fixture.status !== 'finished') return undefined;
    return this.makeStats(fixture);
  }

  private statusOf(kickoffAt: string): FixtureStatus {
    const now = this.now().getTime();
    const kickoff = Date.parse(kickoffAt);
    if (now < kickoff) return 'scheduled';
    if (now < kickoff + MATCH_LENGTH_MS) return 'live';
    return 'finished';
  }

  private makeSquad(club: Club, random: Random): Player[] {
    return SQUAD_SHAPE.map((position, i) => {
      const [lo, hi] = CREDIT_RANGE[position];
      const steps = (hi - lo) / 0.5;
      // Starters are priced higher than the bench.
      const bias = i < STARTERS ? random.next() : random.next() * 0.5;
      return {
        id: `${club.id}-p${i + 1}`,
        clubId: club.id,
        name: `${random.pick(FIRST_NAMES)} ${random.pick(LAST_NAMES)}`,
        position,
        credits: lo + Math.round(bias * steps) * 0.5,
      };
    });
  }

  /** Double round-robin using the circle method. */
  private makeFixtures(start: string, gameweeks: number): Omit<Fixture, 'status'>[] {
    const ids = this.clubs.map((c) => c.id);
    const n = ids.length;
    const fixtures: Omit<Fixture, 'status'>[] = [];
    const rotation = ids.slice(1);
    const startMs = Date.parse(start);

    for (let round = 0; round < gameweeks; round += 1) {
      const order = [ids[0]!, ...rotation];
      const secondHalf = Math.floor(round / (n - 1)) % 2 === 1;
      for (let i = 0; i < n / 2; i += 1) {
        let home = order[i]!;
        let away = order[n - 1 - i]!;
        if (((round % (n - 1)) + i) % 2 === 1) [home, away] = [away, home];
        if (secondHalf) [home, away] = [away, home];
        const gameweek = round + 1;
        // Spread a gameweek's matches across Saturday afternoon and evening.
        const kickoff = startMs + round * WEEK_MS + (i % 2) * 2.5 * 60 * 60 * 1000;
        fixtures.push({
          id: `fx-${gameweek}-${i + 1}`,
          seasonId: 'season-fake-2026',
          gameweek,
          homeClubId: home,
          awayClubId: away,
          kickoffAt: new Date(kickoff).toISOString(),
        });
      }
      rotation.unshift(rotation.pop()!);
    }
    return fixtures;
  }

  private makeStats(fixture: Fixture): StatsSnapshot {
    const random = createRandom(this.seed ^ hashString(fixture.id));
    const homeGoals = random.poisson(1.5);
    const awayGoals = random.poisson(1.15);
    const homePossession = random.int(35, 65);

    const team = (clubId: string, goals: number, possession: number): TeamMatchStats => {
      const shotsOnTarget = goals + random.int(1, 6);
      return {
        clubId,
        goals,
        halfTimeGoals: Array.from({ length: goals }).filter(() => random.next() < 0.45).length,
        shots: shotsOnTarget + random.int(3, 10),
        shotsOnTarget,
        possession,
        corners: random.int(1, 10),
      };
    };
    const home = team(fixture.homeClubId, homeGoals, homePossession);
    const away = team(fixture.awayClubId, awayGoals, 100 - homePossession);

    const players = [
      ...this.playerStats(fixture.homeClubId, home, away, random),
      ...this.playerStats(fixture.awayClubId, away, home, random),
    ];
    return { fixtureId: fixture.id, version: 1, isFinal: true, home, away, players };
  }

  private playerStats(
    clubId: string,
    own: TeamMatchStats,
    opponent: TeamMatchStats,
    random: Random,
  ): PlayerMatchStats[] {
    const squad = this.players.filter((p) => p.clubId === clubId);
    const starters = squad.slice(0, STARTERS);
    const bench = squad.slice(STARTERS);
    const stats = new Map<string, PlayerMatchStats>();
    const blank = (playerId: string, minutes: number): PlayerMatchStats => ({
      playerId,
      minutes,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      ownGoals: 0,
      yellowCards: 0,
      redCards: 0,
      tackles: 0,
      dribbles: 0,
    });

    // Up to three substitutions, each replacing an outfield starter at a random minute.
    const subMinutes = new Map<string, number>();
    const subs = random.int(0, 3);
    for (let i = 0; i < subs; i += 1) {
      const off = starters[random.int(1, STARTERS - 1)]!;
      const on = bench.filter((b) => b.position !== 'GK')[i];
      if (!on || subMinutes.has(off.id)) continue;
      const minute = random.int(55, 85);
      subMinutes.set(off.id, minute);
      stats.set(on.id, blank(on.id, 90 - minute));
    }
    for (const p of starters) stats.set(p.id, blank(p.id, subMinutes.get(p.id) ?? 90));
    for (const p of bench) if (!stats.has(p.id)) stats.set(p.id, blank(p.id, 0));

    const onPitch = [...stats.values()].filter((s) => s.minutes > 0);
    const positionOf = (id: string) => squad.find((p) => p.id === id)!.position;
    const scorerWeight = { GK: 0, DEF: 1, MID: 3, FWD: 6 } as const;

    const weightedPick = () => {
      const pool = onPitch.flatMap((s) => Array(scorerWeight[positionOf(s.playerId)]).fill(s));
      return random.pick(pool) as PlayerMatchStats;
    };

    for (let g = 0; g < own.goals; g += 1) {
      const scorer = weightedPick();
      scorer.goals += 1;
      if (random.next() < 0.7) {
        const others = onPitch.filter((s) => s !== scorer && positionOf(s.playerId) !== 'GK');
        random.pick(others).assists += 1;
      }
    }

    for (const s of onPitch) {
      const position = positionOf(s.playerId);
      const share = s.minutes / 90;
      s.goalsConceded = Math.round(opponent.goals * share);
      if (position === 'GK') s.saves = Math.max(0, opponent.shotsOnTarget - opponent.goals);
      if (position === 'DEF' || position === 'MID') s.tackles = random.poisson(2.2 * share);
      if (position === 'MID' || position === 'FWD') s.dribbles = random.poisson(1.6 * share);
      if (random.next() < 0.12) s.yellowCards = 1;
      if (random.next() < 0.01) s.redCards = 1;
    }

    return [...stats.values()];
  }
}
