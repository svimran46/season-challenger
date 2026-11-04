import 'reflect-metadata';
import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type INestApplication,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FootballFeed } from '@season/feed';
import { WalletErrorFilter } from './common/wallet-error.filter';
import { WORKER_SECONDS, type Clock } from './common/tokens';
import type { Database } from './db/client';
import { EconomyModule } from './economy/economy.module';
import { pinnedFakeFeed } from './feed/feed-sync';
import { createFeed, FeedModule } from './feed.module';
import { FixturesController } from './fixtures/fixtures.controller';
import { FixturesService } from './fixtures/fixtures.service';
import { HealthController } from './health.controller';
import { SquadsController } from './squads/squads.controller';
import { Worker } from './worker';

const CLOSE_DATABASE = Symbol('CLOSE_DATABASE');

/** Closes the database after everything that uses it has shut down. */
@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(CLOSE_DATABASE) private readonly close: () => Promise<void>) {}

  onApplicationShutdown() {
    return this.close();
  }
}

export interface AppModuleOptions {
  /** The provider the API reads directly, or with a database, the one the worker syncs from. */
  feed: FootballFeed;
  clock?: Clock;
  database?: { db: Database; close?: () => Promise<void> };
  workerSeconds: number;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    const close = options.database?.close;
    return {
      module: AppModule,
      imports: [
        FeedModule.register(options.feed, options.database?.db),
        EconomyModule.register({ clock: options.clock }),
      ],
      controllers: [HealthController, FixturesController, SquadsController],
      providers: [
        FixturesService,
        Worker,
        { provide: WORKER_SECONDS, useValue: options.workerSeconds },
        ...(close ? [{ provide: CLOSE_DATABASE, useValue: close }, DatabaseCloser] : []),
      ],
    };
  }
}

export interface CreateAppOptions {
  feed?: FootballFeed;
  /** Time source for rewards, tournaments and vouchers; tests pass the feed's clock. */
  clock?: Clock;
  /** Postgres for the API's data. Without it, everything lives in memory for development. */
  database?: { db: Database; close?: () => Promise<void> };
  /** Seconds between worker runs; 0 stops the timer, so tests run the worker's tick themselves. */
  workerSeconds?: number;
  logger?: false;
}

/** Builds the Nest app. Shared by main.ts and the HTTP tests. */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  const feed =
    options.feed ?? (options.database ? await pinnedFakeFeed(options.database.db) : createFeed());
  const app = await NestFactory.create(
    AppModule.register({
      feed,
      clock: options.clock,
      database: options.database,
      workerSeconds: options.workerSeconds ?? 60,
    }),
    { logger: options.logger === false ? false : undefined },
  );
  app.enableCors();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new WalletErrorFilter());
  app.enableShutdownHooks();
  return app;
}
