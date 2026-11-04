import { Module, type DynamicModule } from '@nestjs/common';
import {
  CLOCK,
  PARTNER_LIMITS,
  PARTNER_STORE,
  VOUCHER_PRESENT_SECRET,
  type Clock,
} from '../common/tokens';
import {
  DEFAULT_PARTNER_LIMITS,
  PartnerAuthService,
  type PartnerLimits,
} from './partner-auth.service';
import { PartnerAuthGuard } from './partner-auth.guard';
import { PartnerVouchersService } from './partner-vouchers.service';
import { PartnerController, PresentCodeController } from './partner.controller';
import type { PartnerStore } from './partner.store';

export interface PartnerOptions {
  clock?: Clock;
  economy: DynamicModule;
  store: PartnerStore;
  presentSecret: string;
  limits?: PartnerLimits;
}

/** Partner sign-in and accepting vouchers at the till, plus the holder's present code. */
@Module({})
export class PartnerModule {
  static register(options: PartnerOptions): DynamicModule {
    return {
      module: PartnerModule,
      imports: [options.economy],
      controllers: [PartnerController, PresentCodeController],
      providers: [
        { provide: CLOCK, useValue: options.clock ?? (() => new Date()) },
        { provide: PARTNER_STORE, useValue: options.store },
        { provide: PARTNER_LIMITS, useValue: options.limits ?? DEFAULT_PARTNER_LIMITS },
        { provide: VOUCHER_PRESENT_SECRET, useValue: options.presentSecret },
        PartnerAuthService,
        PartnerVouchersService,
        PartnerAuthGuard,
      ],
    };
  }
}
