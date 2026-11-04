import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  checkVoucherUse,
  describeDiscount,
  isPresentCodeValid,
  normalizeVoucherCode,
  voucherStatus,
  WalletError,
} from '@season/wallet';
import {
  CLOCK,
  PARTNER_LIMITS,
  PARTNER_STORE,
  VOUCHER_PRESENT_SECRET,
  type Clock,
} from '../common/tokens';
import { AttemptThrottle } from './attempt-throttle';
import type { PartnerLimits } from './partner-auth.service';
import { tooManyAttempts } from './partner.errors';
import type { PartnerStore, PartnerVoucher, StaffRecord } from './partner.store';

export interface AcceptInput {
  code: string;
  presentCode: string;
  reference: string;
  requestId: string;
}

const NO_SUCH_VOUCHER = 'no-such-voucher';

/** The same failure for every way of not proving the voucher, so codes cannot be probed. */
const codesInvalid = () =>
  new WalletError(
    'voucher_codes_invalid',
    'Those codes do not match a voucher for this partner. Check both, and ask for a new present code.',
  );

/** What a partner does at the till. Every path needs both the voucher code and the present code. */
@Injectable()
export class PartnerVouchersService {
  private readonly perStaff: AttemptThrottle;
  private readonly perIp: AttemptThrottle;

  constructor(
    @Inject(PARTNER_STORE) private readonly store: PartnerStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(VOUCHER_PRESENT_SECRET) private readonly presentSecret: string,
    @Inject(PARTNER_LIMITS) limits: PartnerLimits,
  ) {
    this.perStaff = new AttemptThrottle(clock, limits.voucherPerStaff);
    this.perIp = new AttemptThrottle(clock, limits.voucherPerIp);
  }

  async check(staff: StaffRecord, ip: string, code: string, presentCode: string) {
    const voucher = await this.prove(staff, ip, code, presentCode);
    const now = this.clock();
    const status = voucherStatus(voucher, now);
    return {
      code: voucher.code,
      title: voucher.title,
      discountText: describeDiscount(voucher.discount),
      terms: voucher.terms,
      expiresAt: voucher.expiresAt,
      status,
      canAccept: status === 'active',
      usedAt: voucher.usedAt,
      usedReference: voucher.usedReference,
    };
  }

  async accept(staff: StaffRecord, ip: string, input: AcceptInput) {
    const code = normalizeVoucherCode(input.code);
    // A retry gets the first result even if its present code has lapsed since.
    const retried = await this.retried(staff.partnerId, code, input);
    if (retried) return retried;

    const voucher = await this.prove(staff, ip, code, input.presentCode);
    const at = this.clock();
    checkVoucherUse(voucher, staff.partnerId, at);
    const won = await this.store.markUsed({
      voucherId: voucher.id,
      partnerId: staff.partnerId,
      staffId: staff.id,
      reference: input.reference,
      requestId: input.requestId,
      at,
    });
    if (won) {
      const accepted = await this.store.findVoucher(staff.partnerId, code);
      if (accepted) return acceptedView(accepted);
    }
    // Lost a race: either to a parallel copy of this same request, or to another till.
    const parallel = await this.retried(staff.partnerId, code, input);
    if (parallel) return parallel;
    throw new WalletError('voucher_not_usable', 'This voucher has just been used.');
  }

  async list(partnerId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(cursor) : undefined;
    const rows = await this.store.listAccepted(partnerId, { limit: limit + 1, after });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(acceptedView),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  private async retried(partnerId: string, code: string, input: AcceptInput) {
    const first = await this.store.findAcceptance(partnerId, input.requestId);
    if (!first) return null;
    if (first.code !== code || first.usedReference !== input.reference) {
      throw new ConflictException({
        error: 'request_reused',
        message: 'This request id was used for a different acceptance.',
      });
    }
    return acceptedView(first);
  }

  /**
   * Finds the partner's voucher only if the present code proves its holder is at the till. A
   * failure counts against the staff member and the IP address. The HMAC runs either way, so a
   * missing voucher takes as long as a wrong present code.
   */
  private async prove(staff: StaffRecord, ip: string, code: string, presentCode: string) {
    const wait = Math.max(this.perStaff.attempt(staff.id), this.perIp.attempt(ip));
    if (wait > 0) throw tooManyAttempts(wait);

    const voucher = await this.store.findVoucher(staff.partnerId, normalizeVoucherCode(code));
    const proven = isPresentCodeValid(
      voucher?.id ?? NO_SUCH_VOUCHER,
      presentCode,
      this.clock(),
      this.presentSecret,
    );
    if (!voucher || !proven) throw codesInvalid();

    this.perStaff.forgive(staff.id);
    this.perIp.forgive(ip);
    return voucher;
  }
}

/** An accepted voucher, for the receipt screen and the history. */
function acceptedView(v: PartnerVoucher) {
  return {
    code: v.code,
    title: v.title,
    discountText: describeDiscount(v.discount),
    status: 'used' as const,
    usedAt: v.usedAt,
    usedReference: v.usedReference,
    acceptedBy: v.usedByStaffName,
  };
}

/** The voucher code, not an internal id: it is already on the same row of the page. */
function encodeCursor(v: PartnerVoucher): string {
  return Buffer.from(JSON.stringify({ usedAt: v.usedAt, code: v.code })).toString('base64url');
}

function decodeCursor(cursor: string): { usedAt: string; code: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const { usedAt, code } = value as { usedAt?: unknown; code?: unknown };
    if (typeof usedAt === 'string' && typeof code === 'string' && !Number.isNaN(Date.parse(usedAt)))
      return { usedAt, code };
  } catch {
    // Falls through to the refusal below.
  }
  throw new BadRequestException({ error: 'invalid_cursor', message: 'That cursor is not valid.' });
}
