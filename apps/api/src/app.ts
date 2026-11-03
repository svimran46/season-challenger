import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FootballFeed } from '@season/feed';
import { WalletErrorFilter } from './common/wallet-error.filter';
import type { Clock } from './common/tokens';
import { EconomyModule } from './economy/economy.module';
import { FeedModule } from './feed.module';
import { FixturesController } from './fixtures/fixtures.controller';
import { FixturesService } from './fixtures/fixtures.service';
import { HealthController } from './health.controller';
import { SquadsController } from './squads/squads.controller';

@Module({})
export class AppModule {
  static register(options: { feed?: FootballFeed; clock?: Clock } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        FeedModule.register(options.feed),
        EconomyModule.register({ clock: options.clock }),
      ],
      controllers: [HealthController, FixturesController, SquadsController],
      providers: [FixturesService],
    };
  }
}

export interface CreateAppOptions {
  feed?: FootballFeed;
  /** Time source for rewards, tournaments and vouchers; tests pass the feed's clock. */
  clock?: Clock;
  logger?: false;
}

/** Builds the Nest app. Shared by main.ts and the HTTP tests. */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(options), {
    logger: options.logger === false ? false : undefined,
  });
  app.enableCors();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new WalletErrorFilter());
  app.enableShutdownHooks();
  return app;
}
