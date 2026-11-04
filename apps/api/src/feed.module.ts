import { Module, type DynamicModule } from '@nestjs/common';
import { FakeFeed, type FootballFeed } from '@season/feed';
import { DATABASE, FEED_SYNC, FOOTBALL_FEED } from './common/tokens';
import type { Database } from './db/client';
import { FeedSync } from './feed/feed-sync';
import { PgFeed } from './feed/pg-feed';

export function createFeed(kind = process.env.FOOTBALL_FEED ?? 'fake'): FootballFeed {
  switch (kind) {
    case 'fake':
      return new FakeFeed();
    default:
      throw new Error(`Unknown FOOTBALL_FEED "${kind}". Supported: fake.`);
  }
}

@Module({})
export class FeedModule {
  /** With a database, the API reads synced tables and only the sync talks to the provider. */
  static register(upstream: FootballFeed = createFeed(), db?: Database): DynamicModule {
    const providers = db
      ? [
          { provide: DATABASE, useValue: db },
          { provide: FOOTBALL_FEED, useValue: new PgFeed(db, upstream.name) },
          { provide: FEED_SYNC, useValue: new FeedSync(db, upstream) },
        ]
      : [
          { provide: DATABASE, useValue: undefined },
          { provide: FOOTBALL_FEED, useValue: upstream },
          { provide: FEED_SYNC, useValue: undefined },
        ];
    return {
      module: FeedModule,
      global: true,
      providers,
      exports: [DATABASE, FOOTBALL_FEED, FEED_SYNC],
    };
  }
}
