export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export const POSITIONS: readonly Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export interface Club {
  id: string;
  name: string;
  shortName: string;
  /** Primary kit colour as a hex string, used instead of licensed crests. */
  colour: string;
}

export interface Player {
  id: string;
  clubId: string;
  name: string;
  position: Position;
  /** Price in credits for squad building, e.g. 8.5. */
  credits: number;
}

export type FixtureStatus = 'scheduled' | 'live' | 'finished';

export interface Fixture {
  id: string;
  seasonId: string;
  gameweek: number;
  homeClubId: string;
  awayClubId: string;
  /** ISO 8601 kickoff time. Squads and analysis cards lock at kickoff. */
  kickoffAt: string;
  status: FixtureStatus;
}

/** Per-player match stats, as supplied by a football data feed. */
export interface PlayerMatchStats {
  playerId: string;
  minutes: number;
  goals: number;
  assists: number;
  /** Goals conceded by the player's team while they were on the pitch. */
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  tackles: number;
  dribbles: number;
}

/** Team-level match stats used to resolve Season Mastery calls. */
export interface TeamMatchStats {
  clubId: string;
  goals: number;
  halfTimeGoals: number;
  shots: number;
  shotsOnTarget: number;
  /** Possession share, 0 to 100. */
  possession: number;
  corners: number;
}

/** A versioned snapshot of a fixture's stats. Grading always references a version. */
export interface StatsSnapshot {
  fixtureId: string;
  version: number;
  isFinal: boolean;
  home: TeamMatchStats;
  away: TeamMatchStats;
  players: PlayerMatchStats[];
}

export interface SquadPick {
  fixtureId: string;
  playerIds: string[];
  captainId: string;
  viceCaptainId: string;
}

export interface Season {
  id: string;
  competition: string;
  /** ISO dates, inclusive. */
  startsOn: string;
  endsOn: string;
  gameweeks: number;
}
