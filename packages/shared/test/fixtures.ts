import type { Player, PlayerMatchStats, Position, StatsSnapshot, TeamMatchStats } from '../src';

export function player(id: string, clubId: string, position: Position, credits = 8): Player {
  return { id, clubId, name: id, position, credits };
}

/** 22 players: 11 per club in a 1-4-4-2 shape. */
export function twoClubPool(): Player[] {
  const shape: Position[] = [
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
  ];
  return ['h', 'a'].flatMap((club) => shape.map((pos, i) => player(`${club}${i}`, club, pos)));
}

export function stats(
  playerId: string,
  overrides: Partial<PlayerMatchStats> = {},
): PlayerMatchStats {
  return {
    playerId,
    minutes: 90,
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
    ...overrides,
  };
}

export function team(clubId: string, overrides: Partial<TeamMatchStats> = {}): TeamMatchStats {
  return {
    clubId,
    goals: 0,
    halfTimeGoals: 0,
    shots: 10,
    shotsOnTarget: 4,
    possession: 50,
    corners: 5,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    fixtureId: 'f1',
    version: 1,
    isFinal: true,
    home: team('h'),
    away: team('a'),
    players: [],
    ...overrides,
  };
}
