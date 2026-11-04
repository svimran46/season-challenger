import { Module, type DynamicModule } from '@nestjs/common';
import { ApiFootballFeed, FakeFeed, type FootballFeed } from '@season/feed';
import type { FeedConfig } from './config';
import { DATABASE, FEED_SYNC, FOOTBALL_FEED } from './common/tokens';
import type { Database } from './db/client';
import { FeedSync } from './feed/feed-sync';
import { PgFeed } from './feed/pg-feed';

export function createFeed(config: FeedConfig = { kind: 'fake' }): FootballFeed {
  switch (config.kind) {
    case 'fake':
      return new FakeFeed();
    case 'api-football':
      return new ApiFootballFeed({
        apiKey: config.apiKey,
        leagueId: config.leagueId,
        season: config.season,
      });
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
