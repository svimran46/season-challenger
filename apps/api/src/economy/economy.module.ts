import { Module, type DynamicModule } from '@nestjs/common';
import { MemoryLedgerStore, validateOffer, type LedgerStore } from '@season/wallet';
import { CLOCK, ECONOMY_STORES, LEDGER_STORE, type Clock } from '../common/tokens';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { DEMO_OFFERS } from './demo-catalogue';
import { EconomyController } from './economy.controller';
import { MeController } from './me.controller';
import { EconomyStores } from './stores';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { WalletService } from './wallet.service';

export interface EconomyOptions {
  clock?: Clock;
  ledger?: LedgerStore;
}

/** Coins, tournaments and vouchers. */
@Module({})
export class EconomyModule {
  static register(options: EconomyOptions = {}): DynamicModule {
    const clock = options.clock ?? (() => new Date());
    const stores = new EconomyStores();
    for (const offer of DEMO_OFFERS) {
      validateOffer(offer);
      stores.offers.set(offer.id, { ...offer });
    }
    return {
      module: EconomyModule,
      controllers: [EconomyController, MeController, ContestsController, VouchersController],
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: LEDGER_STORE, useValue: options.ledger ?? new MemoryLedgerStore(clock) },
        { provide: ECONOMY_STORES, useValue: stores },
        WalletService,
        ContestsService,
        VouchersService,
      ],
    };
  }
}
