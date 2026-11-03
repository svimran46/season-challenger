import type { Club, Fixture, Player, Season, StatsSnapshot } from '@season/shared';

export interface FixtureFilter {
  gameweek?: number;
  status?: Fixture['status'];
}

/**
 * Everything the app needs from a football data provider. Real providers (API-Football,
 * Sportmonks, ...) get their own adapter behind this interface, so scoring and grading code
 * never depends on a provider's response shapes.
 */
export interface FootballFeed {
  readonly name: string;
  getSeason(): Promise<Season>;
  listClubs(): Promise<Club[]>;
  listPlayers(clubIds?: readonly string[]): Promise<Player[]>;
  listFixtures(filter?: FixtureFilter): Promise<Fixture[]>;
  getFixture(fixtureId: string): Promise<Fixture | undefined>;
  /** Latest stats snapshot, or undefined before kickoff. */
  getStats(fixtureId: string): Promise<StatsSnapshot | undefined>;
}
