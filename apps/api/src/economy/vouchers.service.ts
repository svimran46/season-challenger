import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  describeDiscount,
  dhakaDate,
  generateVoucherCode,
  redemptionBlocker,
  userAccount,
  voucherRedemption,
  voucherStatus,
  type LedgerStore,
  type LedgerUnitOfWork,
  type VoucherCategory,
  type VoucherOffer,
} from '@season/wallet';
import { CLOCK, ECONOMY_REPOSITORY, LEDGER_STORE, type Clock } from '../common/tokens';
import type { EconomyRepository, VoucherRecord } from './stores';
import { userAccounts, WalletService } from './wallet.service';

/** What a player has redeemed this month, as the redemption rules count it. */
function usageOf(mine: readonly VoucherRecord[], offerId: string) {
  return {
    coinsThisMonth: mine.reduce((sum, v) => sum + v.costCoins, 0),
    vouchersThisMonth: mine.length,
    thisOfferThisMonth: mine.filter((v) => v.offerId === offerId).length,
  };
}

@Injectable()
export class VouchersService {
  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_REPOSITORY) private readonly repo: EconomyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  /** Offers on show now. With a signed-in player, each says whether they can redeem it. */
  async offers(category?: VoucherCategory, userId?: string) {
    const now = this.clock();
    const offers = (await this.repo.listOffers()).filter(
      (o) =>
        o.active &&
        (!category || o.category === category) &&
        Date.parse(o.availableFrom) <= now.getTime() &&
        (o.availableUntil === null || Date.parse(o.availableUntil) > now.getTime()),
    );
    const profile = userId ? await this.wallet.ensurePlayer(userId) : undefined;
    const reader = profile ? await this.reader(profile.id) : undefined;
    const mine = profile ? await this.thisMonth(profile.id) : [];
    return offers
      .sort((a, b) => a.costCoins - b.costCoins)
      .map((o) => {
        const blocker =
          profile && reader
            ? redemptionBlocker(reader, {
                offer: o,
                redeemer: { ...profile, userId: profile.id },
                usage: usageOf(mine, o.id),
                now,
              })
            : null;
        return {
          ...this.offerView(o),
          ...(profile ? { canRedeem: blocker === null, reason: blocker?.code ?? null } : {}),
        };
      });
  }

  /**
   * Spends won coins on a voucher. `requestId` comes from the app, so a retried tap returns the
   * voucher already issued instead of charging twice.
   */
  async redeem(userId: string, offerId: string, requestId: string) {
    const profile = await this.wallet.ensurePlayer(userId);
    if (!(await this.repo.getOffer(offerId))) {
      throw new NotFoundException(`Offer ${offerId} not found`);
    }
    return this.ledger.transact(async (uow) => {
      // Lock order: the offer row (stock), then ledger accounts. Retries of one request queue on
      // the offer lock, so the second one finds the voucher the first one issued.
      const offer = await this.repo.getOffer(offerId, uow, { lock: true });
      if (!offer) throw new NotFoundException(`Offer ${offerId} not found`);
      const existing = await this.repo.getVoucher(requestId, uow);
      if (existing) {
        if (existing.userId !== userId || existing.offerId !== offerId) {
          throw new ConflictException({
            error: 'request_reused',
            message: 'This request id was used for a different redemption.',
          });
        }
        return this.voucherView(existing);
      }
      const reader = await uow.lock(userAccounts(userId), [`voucher:${requestId}`]);
      const { draft, voucher } = voucherRedemption(reader, {
        redemptionId: requestId,
        code: await this.uniqueCode(uow),
        offer,
        redeemer: { ...profile, userId: profile.id },
        usage: usageOf(await this.thisMonth(userId, uow), offerId),
        now: this.clock(),
      });
      const txn = await uow.post(draft);
      if (offer.stock !== null) await this.repo.decrementStock(offerId, uow);
      const record: VoucherRecord = {
        ...voucher,
        usedAt: null,
        usedReference: null,
        cancelledAt: null,
        redemptionTxnId: txn.id,
      };
      await this.repo.insertVoucher(record, uow);
      return this.voucherView(record);
    });
  }

  async myVouchers(userId: string) {
    await this.wallet.ensurePlayer(userId);
    return (await this.repo.vouchersOfUser(userId)).map((v) => this.voucherView(v));
  }

  /** The player's vouchers issued this Dhaka calendar month, cancelled ones left out. */
  private async thisMonth(userId: string, uow?: LedgerUnitOfWork) {
    const monthStart = new Date(`${dhakaDate(this.clock()).slice(0, 8)}01T00:00:00+06:00`);
    const issued = await this.repo.vouchersOfUser(userId, { since: monthStart.toISOString() }, uow);
    return issued.filter((v) => !v.cancelledAt);
  }

  private async reader(userId: string) {
    const winnings = await this.ledger.balance(userAccount(userId, 'winnings'));
    return {
      balance: (account: string) => (account === userAccount(userId, 'winnings') ? winnings : 0),
      findByKey: () => undefined,
    };
  }

  private async uniqueCode(uow: LedgerUnitOfWork): Promise<string> {
    for (;;) {
      const code = generateVoucherCode();
      if (!(await this.repo.voucherCodeTaken(code, uow))) return code;
    }
  }

  private offerView(o: VoucherOffer) {
    return {
      id: o.id,
      partnerId: o.partnerId,
      partnerName: o.partnerName,
      category: o.category,
      title: o.title,
      discount: o.discount,
      discountText: describeDiscount(o.discount),
      terms: o.terms,
      costCoins: o.costCoins,
      validForDays: o.validForDays,
      stockLeft: o.stock,
      perUserMonthlyLimit: o.perUserMonthlyLimit,
    };
  }

  private voucherView(v: VoucherRecord) {
    return {
      id: v.id,
      code: v.code,
      offerId: v.offerId,
      partnerName: v.partnerName,
      category: v.category,
      title: v.title,
      discountText: describeDiscount(v.discount),
      costCoins: v.costCoins,
      issuedAt: v.issuedAt,
      expiresAt: v.expiresAt,
      status: voucherStatus(v, this.clock()),
    };
  }
}
