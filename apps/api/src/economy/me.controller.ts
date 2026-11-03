import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, DevAuthGuard } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
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
@UseGuards(DevAuthGuard)
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

  /** Development stand-in for the ID-check provider. Production receives its callback instead. */
  @Post('verification')
  @HttpCode(200)
  verify(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(verificationBody)) body: z.infer<typeof verificationBody>,
  ) {
    return this.wallet.recordVerification(userId, body);
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
