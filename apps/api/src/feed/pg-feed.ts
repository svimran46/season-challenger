import type { FixtureFilter, FootballFeed } from '@season/feed';
import type { Club, Fixture, Player, Season, StatsSnapshot } from '@season/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { club, fixture, player, season, statsSnapshot } from '../db/schema';

type StatsPayload = Pick<StatsSnapshot, 'home' | 'away' | 'players'>;

/** Football data as last synced into Postgres, so reads never call the metered provider. */
export class PgFeed implements FootballFeed {
  constructor(
    private readonly db: Database,
    readonly name: string,
  ) {}

  async getSeason(): Promise<Season> {
    const [row] = await this.db.select().from(season).where(eq(season.isActive, true));
    if (!row) throw new Error('No active season: the feed has not synced yet.');
    return {
      id: row.id,
      competition: row.competition,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      gameweeks: row.gameweeks,
    };
  }

  async listClubs(): Promise<Club[]> {
    const rows = await this.db.select().from(club).orderBy(asc(club.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.shortName,
      colour: r.colour,
    }));
  }

  async listPlayers(clubIds?: readonly string[]): Promise<Player[]> {
    if (clubIds?.length === 0) return [];
    const rows = await this.db
      .select()
      .from(player)
      .where(clubIds ? inArray(player.clubId, [...clubIds]) : undefined)
      .orderBy(asc(player.clubId), asc(player.id));
    return rows.map((r) => ({
      id: r.id,
      clubId: r.clubId,
      name: r.name,
      position: r.position,
      credits: r.credits,
    }));
  }

  async listFixtures(filter: FixtureFilter = {}): Promise<Fixture[]> {
    const rows = await this.db
      .select()
      .from(fixture)
      .where(
        and(
          filter.gameweek === undefined ? undefined : eq(fixture.gameweek, filter.gameweek),
          filter.status === undefined ? undefined : eq(fixture.status, filter.status),
        ),
      )
      .orderBy(asc(fixture.gameweek), asc(fixture.kickoffAt), asc(fixture.id));
    return rows.map(toFixture);
  }

  async getFixture(fixtureId: string): Promise<Fixture | undefined> {
    const [row] = await this.db.select().from(fixture).where(eq(fixture.id, fixtureId));
    return row && toFixture(row);
  }

  async getStats(fixtureId: string): Promise<StatsSnapshot | undefined> {
    const [row] = await this.db
      .select()
      .from(statsSnapshot)
      .where(eq(statsSnapshot.fixtureId, fixtureId))
      .orderBy(desc(statsSnapshot.version))
      .limit(1);
    if (!row) return undefined;
    return {
      fixtureId: row.fixtureId,
      version: row.version,
      isFinal: row.isFinal,
      ...(row.payload as StatsPayload),
    };
  }
}

function toFixture(row: typeof fixture.$inferSelect): Fixture {
  return {
    id: row.id,
    seasonId: row.seasonId,
    gameweek: row.gameweek,
    homeClubId: row.homeClubId,
    awayClubId: row.awayClubId,
    kickoffAt: row.kickoffAt.toISOString(),
    status: row.status,
  };
}
