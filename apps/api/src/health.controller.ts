import { Controller, Get, Inject } from '@nestjs/common';
import type { FootballFeed } from '@season/feed';
import { FOOTBALL_FEED } from './common/tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(FOOTBALL_FEED) private readonly feed: FootballFeed) {}

  @Get()
  health() {
    return { status: 'ok', feed: this.feed.name, time: new Date().toISOString() };
  }
}
