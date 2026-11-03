import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { VOUCHER_CATEGORIES } from '@season/wallet';
import { z } from 'zod';
import { CurrentUser, DevAuthGuard, OptionalUser } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { VouchersService } from './vouchers.service';

const offersQuery = z.object({ category: z.enum(['shop', 'travel']).optional() });
const redeemBody = z.object({ offerId: z.string().min(1), requestId: z.string().uuid() });

// Keeps the query enum in step with the wallet package.
const _categories: readonly ('shop' | 'travel')[] = VOUCHER_CATEGORIES;

@Controller('vouchers')
export class VouchersController {
  constructor(@Inject(VouchersService) private readonly vouchers: VouchersService) {}

  @Get('offers')
  offers(
    @Query(new ZodPipe(offersQuery)) q: z.infer<typeof offersQuery>,
    @OptionalUser() userId?: string,
  ) {
    return this.vouchers.offers(q.category, userId);
  }

  @Post('redeem')
  @UseGuards(DevAuthGuard)
  redeem(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(redeemBody)) body: z.infer<typeof redeemBody>,
  ) {
    return this.vouchers.redeem(userId, body.offerId, body.requestId);
  }
}
