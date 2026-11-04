/** The slices of API-Football v3 responses the adapter reads. Everything else is ignored. */

export interface AfLeague {
  league: { id: number; name: string };
  seasons: { year: number; start: string; end: string; current: boolean }[];
}

export interface AfTeam {
  team: { id: number; name: string; code: string | null };
}

export interface AfSquad {
  team: { id: number };
  players: { id: number; name: string; position: string | null }[];
}

export interface AfPlayerSeason {
  player: { id: number; name: string };
  statistics: { games: { minutes: number | null; rating: string | null } }[];
}

export interface AfFixture {
  fixture: { id: number; timestamp: number; status: { short: string; elapsed: number | null } };
  league: { round: string };
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number | null; away: number | null };
}

export interface AfEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number };
  player: { id: number | null } | null;
  assist: { id: number | null } | null;
  /** "Goal", "Card", "subst" or "Var". */
  type: string;
  /** e.g. "Normal Goal", "Own Goal", "Penalty", "Missed Penalty", "Red Card", "Goal cancelled". */
  detail: string;
}

export interface AfTeamStatistics {
  team: { id: number };
  statistics: { type: string; value: number | string | null }[];
}

export interface AfLineup {
  team: { id: number };
  startXI: { player: { id: number } }[];
  substitutes: { player: { id: number } }[];
}

export interface AfPlayerMatch {
  team: { id: number };
  players: {
    player: { id: number };
    statistics: {
      games: { minutes: number | null };
      goals: {
        total: number | null;
        assists: number | null;
        saves: number | null;
        conceded: number | null;
      };
      cards: { yellow: number | null; red: number | null };
      tackles: { total: number | null };
      dribbles: { success: number | null };
      penalty: { saved: number | null; missed: number | null };
    }[];
  }[];
}

export interface AfFixtureDetail extends AfFixture {
  score: { halftime: { home: number | null; away: number | null } };
  events?: AfEvent[];
  lineups?: AfLineup[];
  statistics?: AfTeamStatistics[];
  players?: AfPlayerMatch[];
}
