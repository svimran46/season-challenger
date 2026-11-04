import { FakeFeed, type FootballFeed } from '@season/feed';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client';
import { FeedSync, pinnedFakeFeed } from '../../src/feed/feed-sync';
import { PgFeed } from '../../src/feed/pg-feed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);

const seasonStart = '2026-08-15T14:00:00.000Z';
let now = new Date('2026-09-01T06:00:00Z'); // gameweek 3 is done, gameweek 4 is next
const fake = new FakeFeed({ seasonStart, now: () => now });
const synced = new PgFeed(db, fake.name);

const byId = <T extends { id: string }>(list: T[]) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id));

beforeEach(async () => {
  now = new Date('2026-09-01T06:00:00Z');
  await db.execute(sql`truncate stats_snapshot, fixture, player, club, season cascade`);
});
afterAll(close);

describe('FeedSync and PgFeed', () => {
  it('serves exactly what the provider supplied', async () => {
    const result = await new FeedSync(db, fake).run();
    expect(result).toMatchObject({ skipped: false, fixtures: 56 });

    expect(await synced.getSeason()).toEqual(await fake.getSeason());
    expect(await synced.listClubs()).toEqual(byId(await fake.listClubs()));
    expect(byId(await synced.listPlayers())).toEqual(byId(await fake.listPlayers()));
    expect(byId(await synced.listFixtures())).toEqual(byId(await fake.listFixtures()));
    expect(await synced.listFixtures({ gameweek: 4, status: 'scheduled' })).toHaveLength(4);
    expect(await synced.getFixture('fx-4-1')).toEqual(await fake.getFixture('fx-4-1'));
    expect(await synced.getFixture('nope')).toBeUndefined();
    expect(await synced.getStats('fx-1-1')).toEqual(await fake.getStats('fx-1-1'));
    expect(await synced.getStats('fx-4-1')).toBeUndefined();
    expect(await synced.listPlayers([])).toEqual([]);
    expect(await synced.listPlayers(['club-1'])).toHaveLength(18);
  });

  it('moves matches on, adds stats once and never writes them again', async () => {
    const first = await new FeedSync(db, fake).run();
    expect(first.statsAdded).toBe(12);
    expect((await new FeedSync(db, fake).run()).statsAdded).toBe(0);

    now = new Date('2026-09-06T00:00:00Z');
    const later = await new FeedSync(db, fake).run();
    expect(later.statsAdded).toBe(4);
    expect((await synced.getFixture('fx-4-1'))?.status).toBe('finished');
  });

  it('appends a stats correction as a new version, and the latest one is served', async () => {
    let version = 1;
    let isFinal = false;
    const corrected: FootballFeed = Object.create(fake);
    corrected.getStats = async (id) => {
      const stats = await fake.getStats(id);
      return stats && { ...stats, version, isFinal };
    };
    await new FeedSync(db, corrected).run();
    version = 2;
    isFinal = true;
    await new FeedSync(db, corrected).run();
    version = 3; // final snapshots are not fetched again
    await new FeedSync(db, corrected).run();

    expect(await synced.getStats('fx-1-1')).toMatchObject({ version: 2, isFinal: true });
    const rows = await db.execute(
      sql`select version from stats_snapshot where fixture_id = 'fx-1-1'`,
    );
    expect(rows).toHaveLength(2);
  });

  it('adds no row when a live match is polled and nothing changed', async () => {
    let version = 10;
    const live: FootballFeed = Object.create(fake);
    live.getStats = async (id) => {
      const stats = await fake.getStats(id);
      return stats && { ...stats, version: (version += 1), isFinal: false };
    };
    expect((await new FeedSync(db, live).run()).statsAdded).toBe(12);
    expect((await new FeedSync(db, live).run()).statsAdded).toBe(0);
  });

  it('shows only the active season after switching provider', async () => {
    await new FeedSync(db, fake).run();
    const other = new FakeFeed({ seasonStart, now: () => now });
    const renamed: FootballFeed = Object.create(other);
    renamed.getSeason = async () => ({ ...(await other.getSeason()), id: 'season-real' });
    renamed.listClubs = async () => [
      { id: 'real-1', name: 'Real One', shortName: 'RO1', colour: '#000000' },
      { id: 'real-2', name: 'Real Two', shortName: 'RO2', colour: '#ffffff' },
    ];
    renamed.listPlayers = async () => [
      { id: 'real-p1', clubId: 'real-1', name: 'A', position: 'GK', credits: 5 },
    ];
    renamed.listFixtures = async () => [
      {
        id: 'real-f1',
        seasonId: 'season-real',
        gameweek: 1,
        homeClubId: 'real-1',
        awayClubId: 'real-2',
        kickoffAt: '2026-09-10T14:00:00.000Z',
        status: 'scheduled',
      },
    ];
    await new FeedSync(db, renamed).run();

    expect((await synced.getSeason()).id).toBe('season-real');
    expect((await synced.listClubs()).map((c) => c.id)).toEqual(['real-1', 'real-2']);
    expect((await synced.listPlayers()).map((p) => p.id)).toEqual(['real-p1']);
    expect((await synced.listFixtures()).map((f) => f.id)).toEqual(['real-f1']);
    expect(await synced.getFixture('fx-1-1')).toBeUndefined();
  });

  it('lets one of two simultaneous syncs write and skips the other', async () => {
    const results = await Promise.all([new FeedSync(db, fake).run(), new FeedSync(db, fake).run()]);
    expect(results.filter((r) => !r.skipped).length).toBeGreaterThanOrEqual(1);
    expect(await synced.listFixtures()).toHaveLength(56);
  });

  it('keeps the fake league on its stored dates after a restart', async () => {
    await new FeedSync(db, fake).run();
    const restarted = await pinnedFakeFeed(db);
    expect((await restarted.getFixture('fx-1-1'))?.kickoffAt).toBe(seasonStart);
    expect(await restarted.getSeason()).toMatchObject({ startsOn: '2026-08-15' });
  });
});
