import { Module, type DynamicModule } from '@nestjs/common';
import {
  MemoryLedgerStore,
  validateOffer,
  type LedgerStore,
  type VoucherOffer,
} from '@season/wallet';
import { CLOCK, ECONOMY_REPOSITORY, LEDGER_STORE, type Clock } from '../common/tokens';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
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
  /** Offers saved on boot. Empty until real partners sign; tests pass a fixture catalogue. */
  offers?: readonly VoucherOffer[];
}

/** Ids of the placeholder offers earlier builds saved on boot. */
const RETIRED_OFFER_PREFIX = 'demo-';

/**
 * Saves the configured offers, and retires placeholder offers earlier builds stored: they are
 * marked inactive, not deleted, so vouchers already issued for them keep working.
 */
export async function seedOffers(
  repository: EconomyRepository,
  offers: readonly VoucherOffer[],
): Promise<void> {
  for (const offer of offers) validateOffer(offer);
  const keep = new Set(offers.map((o) => o.id));
  const retired = (await repository.listOffers())
    .filter((o) => o.active && o.id.startsWith(RETIRED_OFFER_PREFIX) && !keep.has(o.id))
    .map((o) => ({ ...o, active: false }));
  await repository.upsertOffers([...retired, ...offers]);
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
          // The catalogue is saved on boot until partners manage their own offers.
          useFactory: async () => {
            await seedOffers(repository, options.offers ?? []);
            return repository;
          },
        },
        WalletService,
        ContestsService,
        VouchersService,
      ],
      exports: [ContestsService, WalletService],
    };
  }
}
