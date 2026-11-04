import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { issuePresentCode, voucherStatus, WalletError } from '@season/wallet';
import { z } from 'zod';
import { CurrentUser, SignedInGuard } from '../common/auth';
import { CLOCK, ECONOMY_REPOSITORY, VOUCHER_PRESENT_SECRET, type Clock } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import type { EconomyRepository } from '../economy/stores';
import { CurrentPartner, PartnerAuthGuard, PartnerToken } from './partner-auth.guard';
import { identityView, PartnerAuthService } from './partner-auth.service';
import { PartnerVouchersService } from './partner-vouchers.service';
import type { SessionRecord } from './partner.store';

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
const checkBody = z.object({
  code: z.string().trim().min(1).max(40),
  presentCode: z.string().trim().min(1).max(12),
});
const acceptBody = checkBody.extend({
  reference: z.string().trim().min(1).max(100),
  requestId: z.string().uuid(),
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(400).optional(),
});

interface WithIp {
  ip?: string;
}
const ipOf = (req: WithIp) => req.ip ?? 'unknown';

/** What a partner's staff do. Entirely separate from player sign-in. */
@Controller('partner')
export class PartnerController {
  constructor(
    @Inject(PartnerAuthService) private readonly auth: PartnerAuthService,
    @Inject(PartnerVouchersService) private readonly vouchers: PartnerVouchersService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginBody)) body: z.infer<typeof loginBody>, @Req() req: WithIp) {
    return this.auth.login(body.email, body.password, ipOf(req));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(PartnerAuthGuard)
  async logout(@PartnerToken() token: string) {
    await this.auth.logout(token);
  }

  @Get('me')
  @UseGuards(PartnerAuthGuard)
  me(@CurrentPartner() session: SessionRecord) {
    return identityView(session);
  }

  @Post('vouchers/check')
  @HttpCode(200)
  @UseGuards(PartnerAuthGuard)
  check(
    @CurrentPartner() session: SessionRecord,
    @Body(new ZodPipe(checkBody)) body: z.infer<typeof checkBody>,
    @Req() req: WithIp,
  ) {
    return this.vouchers.check(session.staff, ipOf(req), body.code, body.presentCode);
  }

  @Post('vouchers/accept')
  @HttpCode(200)
  @UseGuards(PartnerAuthGuard)
  accept(
    @CurrentPartner() session: SessionRecord,
    @Body(new ZodPipe(acceptBody)) body: z.infer<typeof acceptBody>,
    @Req() req: WithIp,
  ) {
    return this.vouchers.accept(session.staff, ipOf(req), body);
  }

  @Get('vouchers')
  @UseGuards(PartnerAuthGuard)
  list(
    @CurrentPartner() session: SessionRecord,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.vouchers.list(session.partner.id, q.limit, q.cursor);
  }
}

/** Only the signed-in holder can get the code that lets a partner accept their voucher. */
@Controller('me/vouchers')
@UseGuards(SignedInGuard)
export class PresentCodeController {
  constructor(
    @Inject(ECONOMY_REPOSITORY) private readonly repo: EconomyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(VOUCHER_PRESENT_SECRET) private readonly secret: string,
  ) {}

  @Post(':id/present')
  @HttpCode(200)
  async present(@CurrentUser() userId: string, @Param('id') id: string) {
    const voucher = z.string().uuid().safeParse(id).success
      ? await this.repo.getVoucher(id)
      : undefined;
    if (!voucher || voucher.userId !== userId) {
      throw new NotFoundException({ error: 'voucher_not_found', message: 'Voucher not found.' });
    }
    const now = this.clock();
    const status = voucherStatus(voucher, now);
    if (status !== 'active') {
      throw new WalletError('voucher_not_usable', `This voucher is ${status}.`);
    }
    return issuePresentCode(voucher, now, this.secret);
  }
}
