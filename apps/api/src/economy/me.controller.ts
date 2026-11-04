import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { authMode, CurrentUser, SignedInGuard } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { documentHash } from '../kyc/identity-hash';
import { ContestsService } from './contests.service';
import { VouchersService } from './vouchers.service';
import { WalletService } from './wallet.service';

const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const verificationBody = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documentNumber: z.string().min(6).max(40),
});

/** The signed-in player's wallet, entries and vouchers. */
@Controller('me')
@UseGuards(SignedInGuard)
export class MeController {
  constructor(
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(ContestsService) private readonly contests: ContestsService,
    @Inject(VouchersService) private readonly vouchers: VouchersService,
  ) {}

  @Get('wallet')
  getWallet(@CurrentUser() userId: string) {
    return this.wallet.wallet(userId);
  }

  @Get('wallet/activity')
  activity(
    @CurrentUser() userId: string,
    @Query(new ZodPipe(activityQuery)) q: z.infer<typeof activityQuery>,
  ) {
    return this.wallet.activity(userId, q.limit);
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(@CurrentUser() userId: string) {
    return this.wallet.checkIn(userId);
  }

  /**
   * Development shortcut: verifies at once from typed details, for tests and scripts. Off (404)
   * unless AUTH_MODE is dev, so production players always go through the document upload.
   */
  @Post('verification')
  @HttpCode(200)
  verify(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(verificationBody)) body: z.infer<typeof verificationBody>,
  ) {
    if (authMode() !== 'dev') throw new NotFoundException();
    return this.wallet.recordVerification(userId, {
      birthDate: body.birthDate,
      idDocumentHash: documentHash(body.documentNumber),
    });
  }

  @Get('entries')
  entries(@CurrentUser() userId: string) {
    return this.contests.myEntries(userId);
  }

  @Get('vouchers')
  myVouchers(@CurrentUser() userId: string) {
    return this.vouchers.myVouchers(userId);
  }
}
