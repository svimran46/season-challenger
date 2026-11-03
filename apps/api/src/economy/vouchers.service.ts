import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  describeDiscount,
  dhakaMonth,
  generateVoucherCode,
  redemptionBlocker,
  userAccount,
  voucherRedemption,
  voucherStatus,
  type LedgerStore,
  type VoucherCategory,
  type VoucherOffer,
} from '@season/wallet';
import { CLOCK, ECONOMY_STORES, LEDGER_STORE, type Clock } from '../common/tokens';
import type { EconomyStores, VoucherRecord } from './stores';
import { userAccounts, WalletService } from './wallet.service';

@Injectable()
export class VouchersService {
  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_STORES) private readonly stores: EconomyStores,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  /** Offers on show now. With a signed-in player, each says whether they can redeem it. */
  async offers(category?: VoucherCategory, userId?: string) {
    const now = this.clock();
    const offers = [...this.stores.offers.values()].filter(
      (o) =>
        o.active &&
        (!category || o.category === category) &&
        Date.parse(o.availableFrom) <= now.getTime() &&
        (o.availableUntil === null || Date.parse(o.availableUntil) > now.getTime()),
    );
    const profile = userId ? await this.wallet.ensurePlayer(userId) : undefined;
    const reader = profile ? await this.reader(profile.id) : undefined;
    return offers
      .sort((a, b) => a.costCoins - b.costCoins)
      .map((o) => {
        const blocker =
          profile && reader
            ? redemptionBlocker(reader, {
                offer: o,
                redeemer: { ...profile, userId: profile.id },
                usage: this.usage(profile.id, o.id),
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
    const offer = this.stores.offers.get(offerId);
    if (!offer) throw new NotFoundException(`Offer ${offerId} not found`);
    return this.ledger.transact(async (uow) => {
      const existing = this.stores.vouchers.get(requestId);
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
        code: this.uniqueCode(),
        offer,
        redeemer: { ...profile, userId: profile.id },
        usage: this.usage(userId, offerId),
        now: this.clock(),
      });
      await uow.post(draft);
      if (offer.stock !== null) offer.stock -= 1;
      const record: VoucherRecord = {
        ...voucher,
        usedAt: null,
        usedReference: null,
        cancelledAt: null,
      };
      this.stores.vouchers.set(record.id, record);
      return this.voucherView(record);
    });
  }

  async myVouchers(userId: string) {
    await this.wallet.ensurePlayer(userId);
    return [...this.stores.vouchers.values()]
      .filter((v) => v.userId === userId)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map((v) => this.voucherView(v));
  }

  private usage(userId: string, offerId: string) {
    const month = dhakaMonth(this.clock());
    const mine = [...this.stores.vouchers.values()].filter(
      (v) => v.userId === userId && !v.cancelledAt && dhakaMonth(new Date(v.issuedAt)) === month,
    );
    return {
      coinsThisMonth: mine.reduce((sum, v) => sum + v.costCoins, 0),
      vouchersThisMonth: mine.length,
      thisOfferThisMonth: mine.filter((v) => v.offerId === offerId).length,
    };
  }

  private async reader(userId: string) {
    const winnings = await this.ledger.balance(userAccount(userId, 'winnings'));
    return {
      balance: (account: string) => (account === userAccount(userId, 'winnings') ? winnings : 0),
      findByKey: () => undefined,
    };
  }

  private uniqueCode(): string {
    const taken = new Set([...this.stores.vouchers.values()].map((v) => v.code));
    for (;;) {
      const code = generateVoucherCode();
      if (!taken.has(code)) return code;
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
