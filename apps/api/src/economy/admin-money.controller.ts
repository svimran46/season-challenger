import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { WithdrawalStatus } from '@season/wallet';
import { AdminGuard } from '../common/admin';
import { ZodPipe } from '../common/zod.pipe';
import { MONEY_SERVICE } from './money.tokens';
import type { MoneyService } from './money.service';

const statusQuery = z.object({ status: z.string().max(120).optional() });
const reviewBody = z.object({
  action: z.enum(['approve', 'paid', 'reject', 'fail']),
  /** The e-wallet or bank transaction id recorded once the taka has actually gone out. */
  payoutReference: z.string().min(4).max(80).optional(),
  /** Why a request was rejected or failed; shown to the player. */
  reason: z.string().min(1).max(240).optional(),
  /** Who ran the review, for the audit line. Defaults to "admin". */
  operator: z.string().min(1).max(64).optional(),
});

const WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = [
  'pending',
  'approved',
  'rejected',
  'paid',
  'failed',
];

/**
 * The payout review queue, the way Game of 11 settles withdrawals: requests arrive here with
 * the user's details, an operator checks them, sends the taka over the e-wallet outside the
 * system, and marks the request paid with the reference (or rejects it, which releases the
 * hold). Everything is token-guarded; nothing here moves money by itself.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminMoneyController {
  constructor(@Inject(MONEY_SERVICE) private readonly money: MoneyService) {}

  /** The queue. Defaults to open requests (pending + approved). */
  @Get('withdrawals')
  queue(@Query(new ZodPipe(statusQuery)) q: z.infer<typeof statusQuery>) {
    return this.money.adminWithdrawals(parseStatuses(q.status));
  }

  @Post('withdrawals/:id/review')
  review(@Param('id') id: string, @Body(new ZodPipe(reviewBody)) body: z.infer<typeof reviewBody>) {
    return this.money.reviewWithdrawal(id, {
      action: body.action,
      payoutReference: body.payoutReference,
      reason: body.reason,
      operator: body.operator,
    });
  }
}

function parseStatuses(value: string | undefined): WithdrawalStatus[] {
  if (!value) return [];
  const parts = value.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (!WITHDRAWAL_STATUSES.includes(part as WithdrawalStatus)) {
      throw new Error(`Unknown withdrawal status "${part}".`);
    }
  }
  return parts as WithdrawalStatus[];
}
