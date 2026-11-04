import { Module, type DynamicModule } from '@nestjs/common';
import { MemoryLedgerStore, validateOffer, type LedgerStore } from '@season/wallet';
import { CLOCK, ECONOMY_REPOSITORY, LEDGER_STORE, type Clock } from '../common/tokens';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { DEMO_OFFERS } from './demo-catalogue';
import { EconomyController } from './economy.controller';
import { MeController } from './me.controller';
import { MemoryEconomyRepository } from './memory-economy.repository';
import type { EconomyRepository } from './stores';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { WalletService } from './wallet.service';

export interface EconomyOptions {
  clock?: Clock;
  /** The coin ledger; in memory unless given (PgLedgerStore with a database). */
  ledger?: LedgerStore;
  /** Players, tournaments and vouchers; in memory unless given (PgEconomyRepository). */
  repository?: EconomyRepository;
}

/** Coins, tournaments and vouchers. */
@Module({})
export class EconomyModule {
  static register(options: EconomyOptions = {}): DynamicModule {
    const clock = options.clock ?? (() => new Date());
    const repository = options.repository ?? new MemoryEconomyRepository();
    return {
      module: EconomyModule,
      controllers: [EconomyController, MeController, ContestsController, VouchersController],
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: LEDGER_STORE, useValue: options.ledger ?? new MemoryLedgerStore(clock) },
        {
          provide: ECONOMY_REPOSITORY,
          // The demo catalogue is saved on boot until partners manage their own offers.
          useFactory: async () => {
            for (const offer of DEMO_OFFERS) validateOffer(offer);
            await repository.upsertOffers(DEMO_OFFERS);
            return repository;
          },
        },
        WalletService,
        ContestsService,
        VouchersService,
      ],
      exports: [ContestsService],
    };
  }
}
