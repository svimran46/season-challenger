import { Module, type DynamicModule } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/tokens';
import { MasteryController } from './mastery.controller';
import { GRADE_ON_READ, MASTERY_STORE, MasteryService, PLAYER_NAMES } from './mastery.service';
import { MemoryMasteryStore, type MasteryStore } from './mastery.store';
import { noPlayerNames, type PlayerNames } from './player-names';

export interface MasteryOptions {
  clock?: Clock;
  economy: DynamicModule;
  /** In memory unless given (PgMasteryStore). */
  store?: MasteryStore;
  names?: PlayerNames;
  gradeOnRead: boolean;
}

/** Season Mastery: pre-match analysis cards, grading, season rating and tiers. */
@Module({})
export class MasteryModule {
  static register(options: MasteryOptions): DynamicModule {
    return {
      module: MasteryModule,
      imports: [options.economy],
      controllers: [MasteryController],
      providers: [
        { provide: CLOCK, useValue: options.clock ?? (() => new Date()) },
        { provide: MASTERY_STORE, useValue: options.store ?? new MemoryMasteryStore() },
        { provide: PLAYER_NAMES, useValue: options.names ?? noPlayerNames },
        { provide: GRADE_ON_READ, useValue: options.gradeOnRead },
        MasteryService,
      ],
      exports: [MasteryService],
    };
  }
}
