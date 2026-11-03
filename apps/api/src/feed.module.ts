import { Module, type DynamicModule } from '@nestjs/common';
import { FakeFeed, type FootballFeed } from '@season/feed';
import { FOOTBALL_FEED } from './common/tokens';

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
  static register(feed: FootballFeed = createFeed()): DynamicModule {
    return {
      module: FeedModule,
      global: true,
      providers: [{ provide: FOOTBALL_FEED, useValue: feed }],
      exports: [FOOTBALL_FEED],
    };
  }
}
