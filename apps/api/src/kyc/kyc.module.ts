import { Module, type DynamicModule } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CLOCK, type Clock } from '../common/tokens';
import { EconomyModule } from '../economy/economy.module';
import { ReviewController, ReviewerGuard, VerificationController } from './kyc.controller';
import {
  DOCUMENT_VAULT,
  KYC_SETTINGS,
  KYC_STORE,
  KycService,
  type KycSettings,
} from './kyc.service';
import type { DocumentVault, KycStore } from './kyc.types';
import { MemoryKycStore } from './memory-kyc.store';
import { ReviewPageController } from './review-page.controller';
import { EncryptedVault, MemoryBlobBackend } from './vault';

/** Development key; config.ts refuses to start production without KYC_ENCRYPTION_KEY. */
export const DEV_KYC_KEY = createHash('sha256').update('dev-only-kyc-key').digest();

export interface KycOptions {
  clock?: Clock;
  economy: DynamicModule;
  /** Submissions; in memory unless given (PgKycStore). */
  store?: KycStore;
  /** Photos; encrypted in memory unless given. */
  vault?: DocumentVault;
  settings?: Partial<KycSettings>;
}

/** ID document upload and manual review for voucher redemption. */
@Module({})
export class KycModule {
  static register(options: KycOptions): DynamicModule {
    const settings: KycSettings = {
      sealKey: DEV_KYC_KEY,
      retentionDays: 90,
      ...options.settings,
    };
    return {
      module: KycModule,
      imports: [options.economy],
      controllers: [VerificationController, ReviewController, ReviewPageController],
      providers: [
        { provide: CLOCK, useValue: options.clock ?? (() => new Date()) },
        { provide: KYC_STORE, useValue: options.store ?? new MemoryKycStore() },
        {
          provide: DOCUMENT_VAULT,
          useValue:
            options.vault ??
            new EncryptedVault(new MemoryBlobBackend(), settings.sealKey, 'memory'),
        },
        { provide: KYC_SETTINGS, useValue: settings },
        ReviewerGuard,
        KycService,
      ],
      exports: [KycService],
    };
  }
}
