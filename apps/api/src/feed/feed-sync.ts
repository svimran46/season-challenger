import { FakeFeed, type FootballFeed } from '@season/feed';
import type { StatsSnapshot } from '@season/shared';
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, inArray, min, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { club, fixture, player, season, statsSnapshot } from '../db/schema';

/** Key for the advisory lock that lets one API instance at a time write a sync. */
const SYNC_LOCK = 7_301_001;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

export interface SyncResult {
  /** Another instance held the lock, so this run wrote nothing. */
  skipped: boolean;
  fixtures: number;
  statsAdded: number;
}

/**
 * Copies the provider's data into Postgres. Upserts are safe to repeat, and stats snapshots are
 * append-only by version, so a correction adds a row and never rewrites what grading used.
 * Provider calls happen before the transaction, so a slow provider never holds a database lock.
 */
export class FeedSync {
  constructor(
    private readonly db: Database,
    private readonly upstream: FootballFeed,
  ) {}

  async run(): Promise<SyncResult> {
    const [seasonData, clubs, players, fixtures] = await Promise.all([
      this.upstream.getSeason(),
      this.upstream.listClubs(),
      this.upstream.listPlayers(),
      this.upstream.listFixtures(),
    ]);
    const stats = await this.statsToFetch(fixtures.filter((f) => f.status !== 'scheduled'));

    return this.db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${SYNC_LOCK}) as locked`,
      );
      if (!lock?.locked) return { skipped: true, fixtures: 0, statsAdded: 0 };

      await tx
        .insert(season)
        .values({ ...seasonData, isActive: true })
        .onConflictDoUpdate({
          target: season.id,
          set: {
            competition: excluded('competition'),
            startsOn: excluded('starts_on'),
            endsOn: excluded('ends_on'),
            gameweeks: excluded('gameweeks'),
            isActive: true,
          },
        });
      await tx.update(season).set({ isActive: false }).where(ne(season.id, seasonData.id));

      if (clubs.length > 0) {
        await tx
          .insert(club)
          .values(clubs)
          .onConflictDoUpdate({
            target: club.id,
            set: {
              name: excluded('name'),
              shortName: excluded('short_name'),
              colour: excluded('colour'),
            },
          });
      }
      if (players.length > 0) {
        await tx
          .insert(player)
          .values(players)
          .onConflictDoUpdate({
            target: player.id,
            set: {
              clubId: excluded('club_id'),
              name: excluded('name'),
              position: excluded('position'),
              credits: excluded('credits'),
            },
          });
      }
      if (fixtures.length > 0) {
        await tx
          .insert(fixture)
          .values(fixtures.map((f) => ({ ...f, kickoffAt: new Date(f.kickoffAt) })))
          .onConflictDoUpdate({
            target: fixture.id,
            set: {
              gameweek: excluded('gameweek'),
              homeClubId: excluded('home_club_id'),
              awayClubId: excluded('away_club_id'),
              kickoffAt: excluded('kickoff_at'),
              status: excluded('status'),
            },
          });
      }

      let statsAdded = 0;
      for (const s of stats) {
        const { fixtureId, version, isFinal, ...payload } = s;
        // A live provider is polled every tick; only a change in the numbers earns a new row.
        const [latest] = await tx
          .select({ isFinal: statsSnapshot.isFinal, payload: statsSnapshot.payload })
          .from(statsSnapshot)
          .where(eq(statsSnapshot.fixtureId, fixtureId))
          .orderBy(desc(statsSnapshot.version))
          .limit(1);
        if (
          latest &&
          latest.isFinal === isFinal &&
          isDeepStrictEqual(latest.payload, JSON.parse(JSON.stringify(payload)))
        ) {
          continue;
        }
        const added = await tx
          .insert(statsSnapshot)
          .values({ fixtureId, version, isFinal, payload })
          .onConflictDoNothing()
          .returning({ version: statsSnapshot.version });
        statsAdded += added.length;
      }
      return { skipped: false, fixtures: fixtures.length, statsAdded };
    });
  }

  /** Stats for every started match that does not have its final snapshot yet. */
  private async statsToFetch(started: { id: string }[]): Promise<StatsSnapshot[]> {
    if (started.length === 0) return [];
    const final = await this.db
      .select({ fixtureId: statsSnapshot.fixtureId })
      .from(statsSnapshot)
      .where(
        and(
          eq(statsSnapshot.isFinal, true),
          inArray(
            statsSnapshot.fixtureId,
            started.map((f) => f.id),
          ),
        ),
      );
    const done = new Set(final.map((r) => r.fixtureId));
    const fetched = await Promise.all(
      started.filter((f) => !done.has(f.id)).map((f) => this.upstream.getStats(f.id)),
    );
    return fetched.filter((s): s is StatsSnapshot => s !== undefined);
  }
}

/**
 * The fake league counts its season back from today unless told otherwise, so once its fixtures
 * are stored a restart must reuse the stored start or finished matches would become upcoming.
 */
export async function pinnedFakeFeed(db: Database): Promise<FakeFeed> {
  const [row] = await db.select({ start: min(fixture.kickoffAt) }).from(fixture);
  return new FakeFeed(row?.start ? { seasonStart: row.start.toISOString() } : {});
}
