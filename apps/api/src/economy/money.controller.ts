import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { PayoutChannel } from '@season/wallet';
import { CurrentUser, SignedInGuard } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { MONEY_SERVICE } from './money.tokens';
import type { MoneyService } from './money.service';

const depositBody = z.object({
  amountBdt: z.coerce.number().int().min(1).max(1_000_000),
  channel: z.enum(['bkash', 'nagad', 'rocket', 'upay', 'bank']),
});
const amountBody = z.object({
  amountBdt: z.coerce.number().int().min(1).max(1_000_000),
  /** One id per attempt, so a double tap or retry never moves money twice. */
  requestId: z.string().min(8).max(64),
});
const convertBody = z.object({
  coins: z.coerce.number().int().min(1),
  requestId: z.string().min(8).max(64),
});
const withdrawBody = z.object({
  amountBdt: z.coerce.number().int().min(1).max(1_000_000),
  channel: z.enum(['bkash', 'nagad', 'rocket', 'upay', 'bank']),
  /** The e-wallet number or bank account the taka is sent to. */
  destination: z.string().min(4).max(40),
  requestId: z.string().min(8).max(64),
});
const emptyQuery = z.object({});

/**
 * The signed-in player's money endpoints: buy coins with an e-wallet, turn cash into coins,
 * convert won coins into cash, and put a cash-out into the operator review queue.
 */
@Controller('me')
@UseGuards(SignedInGuard)
export class MoneyController {
  constructor(@Inject(MONEY_SERVICE) private readonly money: MoneyService) {}

  @Get('money')
  overview(@CurrentUser() userId: string) {
    return this.money.overview(userId);
  }

  @Post('deposits')
  @HttpCode(201)
  deposit(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(depositBody)) body: z.infer<typeof depositBody>,
  ) {
    return this.money.createDeposit(userId, {
      amountBdt: body.amountBdt,
      channel: body.channel as PayoutChannel,
    });
  }

  @Get('deposits')
  deposits(@CurrentUser() userId: string) {
    return this.money.myDeposits(userId);
  }

  /** Cash → coins. */
  @Post('redeem')
  @HttpCode(200)
  redeem(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(amountBody)) body: z.infer<typeof amountBody>,
  ) {
    return this.money.redeem(userId, {
      amountBdt: body.amountBdt,
      redemptionId: body.requestId,
    });
  }

  /** Won coins → cash. */
  @Post('convert')
  @HttpCode(200)
  convert(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(convertBody)) body: z.infer<typeof convertBody>,
  ) {
    return this.money.convertCoinsToCash(userId, {
      coins: body.coins,
      conversionId: body.requestId,
    });
  }

  /** Cash → the operator review queue; the request is held as soon as this lands. */
  @Post('withdrawals')
  @HttpCode(201)
  withdraw(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(withdrawBody)) body: z.infer<typeof withdrawBody>,
  ) {
    return this.money.requestWithdrawal(userId, {
      amountBdt: body.amountBdt,
      channel: body.channel as PayoutChannel,
      destination: body.destination,
      requestId: body.requestId,
    });
  }

  @Get('withdrawals')
  withdrawals(@CurrentUser() userId: string, @Query(new ZodPipe(emptyQuery)) _: unknown) {
    return this.money.myWithdrawals(userId);
  }
}
