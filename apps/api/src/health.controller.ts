import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { FootballFeed } from '@season/feed';
import { sql } from 'drizzle-orm';
import { DATABASE, FOOTBALL_FEED } from './common/tokens';
import type { Database } from './db/client';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(FOOTBALL_FEED) private readonly feed: FootballFeed,
    @Optional() @Inject(DATABASE) private readonly db: Database | undefined,
  ) {}

  @Get()
  async health() {
    if (this.db) {
      await this.db.execute(sql`select 1`).catch(() => {
        throw new ServiceUnavailableException('The database is not reachable.');
      });
    }
    return {
      status: 'ok',
      feed: this.feed.name,
      store: this.db ? 'postgres' : 'memory',
      time: new Date().toISOString(),
    };
  }
}
