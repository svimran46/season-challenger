import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FootballFeed } from '@season/feed';
import { FeedModule } from './feed.module';
import { FixturesController } from './fixtures/fixtures.controller';
import { FixturesService } from './fixtures/fixtures.service';
import { HealthController } from './health.controller';
import { SquadsController } from './squads/squads.controller';

@Module({})
export class AppModule {
  static register(feed?: FootballFeed): DynamicModule {
    return {
      module: AppModule,
      imports: [FeedModule.register(feed)],
      controllers: [HealthController, FixturesController, SquadsController],
      providers: [FixturesService],
    };
  }
}

export interface CreateAppOptions {
  feed?: FootballFeed;
  logger?: false;
}

/** Builds the Nest app. Shared by main.ts and the HTTP tests. */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(options.feed), {
    logger: options.logger === false ? false : undefined,
  });
  app.enableCors();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableShutdownHooks();
  return app;
}
