import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  PAYOUT_CHANNELS,
  WalletError,
  cashAccount,
  checkSettings,
  coinToCashDraft,
  depositCoins,
  depositDraft,
  depositRefundDraft,
  redeemDraft,
  userAccount,
  withdrawHoldDraft,
  withdrawPaidDraft,
  withdrawReleaseDraft,
  type LedgerStore,
  type MoneySettings,
  type PayoutChannel,
  type WithdrawalStatus,
} from '@season/wallet';
import { CLOCK, ECONOMY_REPOSITORY, LEDGER_STORE, type Clock } from '../common/tokens';
import {
  MockGateway,
  signWebhookBody,
  verifyWebhookSignature,
  type PaymentGateway,
  type WebhookDelivery,
} from './payments/gateway';
import type { DepositInvoiceRecord, EconomyRepository, WithdrawalRecord } from './stores';
import { WalletService } from './wallet.service';

/** How the money module is set up; built from the API config. */
export interface MoneyOptions {
  settings: MoneySettings;
  /** Which gateway adapter runs deposit checkouts; the mock ships today. */
  gateway: 'mock';
  /** Secret the gateway signs webhook bodies with. */
  paymentsSecret: string;
  /** Absolute base URL of this API, so the app can open the mock checkout page. */
  apiPublicUrl: string;
  /** Minutes a pending deposit invoice may still be paid within. */
  invoiceValidityMinutes: number;
}

export const MONEY_OPTIONS = Symbol('MONEY_OPTIONS');

const OPEN_STATUSES: readonly WithdrawalStatus[] = ['pending', 'approved'];
const FINAL_STATUSES: readonly WithdrawalStatus[] = ['rejected', 'paid', 'failed'];

/**
 * Deposits, redeems, conversions and withdrawals, with the Game of 11 rules: coins bought with
 * taka are entry currency only; cash on the winnings side converts both ways at server-set
 * rates; and every cash-out waits in a review queue that an operator settles one by one, with
 * the payout reference recorded when the money actually goes out.
 */
@Injectable()
export class MoneyService {
  private readonly gateway: PaymentGateway;

  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_REPOSITORY) private readonly repo: EconomyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_OPTIONS) private readonly options: MoneyOptions,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {
    checkSettings(options.settings);
    // Only the mock adapter exists so far; a bKash/Nagad adapter drops in here behind the
    // same interface without new credit logic.
    this.gateway = new MockGateway(this.options.apiPublicUrl);
  }

  /** The explainer the app's money screen shows: rates, limits and how the taka flows. */
  rules() {
    return {
      enabled: true,
      moneyIn: true,
      moneyOut: true,
      balances: {
        cash: 'Taka you can withdraw or turn back into coins. It only comes from won coins.',
      },
      deposit: {
        channels: [...PAYOUT_CHANNELS],
        minBdt: this.settings.minDepositBdt,
        maxBdt: this.settings.maxDepositBdt,
        coinsPerBdt: this.settings.coinsPerBdt,
        note: 'Bought coins pay tournament entries. They can never be withdrawn.',
      },
      redeem: {
        minBdt: this.settings.minRedeemBdt,
        coinsPerBdt: this.settings.coinsPerBdt,
        note: 'Cash back into coins, at the same rate it was bought.',
      },
      coinToCash: {
        minBdt: this.settings.minConversionBdt,
        coinsPerBdt: this.settings.coinToCashCoinsPerBdt,
        note: 'Won coins into cash. Costs more coins per taka than buying, so deposits stay entry money.',
      },
      withdraw: {
        channels: [...PAYOUT_CHANNELS],
        minBdt: this.settings.minWithdrawBdt,
        maxBdt: this.settings.maxWithdrawBdt,
        note: 'Cash is held on request, then an operator pays it out manually over the wallet.',
      },
    };
  }

  private get settings(): MoneySettings {
    return this.options.settings;
  }

  async overview(userId: string) {
    const profile = await this.wallet.ensurePlayer(userId);
    const cash = await this.ledger.balance(cashAccount(userId));
    const requests = await this.repo.withdrawalsOfUser(userId);
    const open = requests.filter((r) => OPEN_STATUSES.includes(r.status));
    return {
      cash,
      pendingWithdrawals: open.reduce((sum, r) => sum + r.amountBdt, 0),
      openRequests: open.length,
      verified: profile.idVerifiedAt !== null,
      rules: this.rules(),
    };
  }

  // ---------------------------------------------------------------- deposits

  /** Creates a pending deposit invoice with the hosted checkout link to pay it. */
  async createDeposit(userId: string, input: { amountBdt: number; channel: PayoutChannel }) {
    await this.wallet.ensurePlayer(userId);
    if (!PAYOUT_CHANNELS.includes(input.channel)) {
      throw new WalletError(
        'invalid_payout',
        `Choose one of ${PAYOUT_CHANNELS.join(', ')} for the deposit, not "${input.channel}".`,
      );
    }
    // depositCoins() validates the amount against the limits and prices the coins.
    const coins = depositCoins(input.amountBdt, this.settings);
    const now = this.clock();
    const invoice: DepositInvoiceRecord = {
      id: `INV-${randomBytes(6).toString('hex').toUpperCase()}`,
      userId,
      gateway: this.gateway.id,
      channel: input.channel,
      amountBdt: input.amountBdt,
      coins,
      status: 'pending',
      checkoutUrl: null,
      depositTxnId: null,
      paidAt: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + this.options.invoiceValidityMinutes * 60_000,
      ).toISOString(),
    };
    // The gateway says where to pay; the mock points at this API's own simulation page.
    invoice.checkoutUrl = await this.gateway.createCheckout(invoice);
    await this.ledger.transact(async (uow) => {
      await this.repo.insertInvoice(invoice, uow);
    });
    return {
      paymentId: invoice.id,
      paymentUrl: invoice.checkoutUrl,
      amountBdt: invoice.amountBdt,
      coins: invoice.coins,
      channel: invoice.channel,
      gateway: invoice.gateway,
      expiresAt: invoice.expiresAt,
    };
  }

  async myDeposits(userId: string): Promise<DepositInvoiceRecord[]> {
    await this.wallet.ensurePlayer(userId);
    return this.repo.invoicesOfUser(userId);
  }

  /**
   * Credits or fails a deposit from one gateway webhook delivery, exactly once. The true
   * idempotency anchor is the ledger's `deposit:<invoiceId>` key, so retries and replays post
   * nothing; a delivery for an unknown, expired or already-settled invoice changes nothing.
   */
  async applyWebhook(input: {
    gateway: string;
    delivery: WebhookDelivery | null;
    raw: string;
    signature: string | undefined;
  }): Promise<Record<string, unknown>> {
    const signatureValid = verifyWebhookSignature(
      input.raw,
      input.signature,
      this.options.paymentsSecret,
    );
    const delivery = input.delivery;
    if (!signatureValid || !delivery?.eventId || !delivery.paymentId) {
      // Keep an unreadable or tampered delivery on record, then refuse it.
      await this.repo.insertWebhookEvent({
        gateway: input.gateway,
        eventId: delivery?.eventId ?? `unparsed-${this.clock().toISOString()}`,
        invoiceId: null,
        signatureValid,
        payload: safeJson(input.raw),
        processedAt: this.clock().toISOString(),
        createdAt: this.clock().toISOString(),
      });
      if (!signatureValid) {
        throw new BadRequestException({
          error: 'bad_signature',
          message: 'The payment signature does not match, so the delivery was not processed.',
        });
      }
      return { received: true, credited: false, reason: 'unreadable_delivery' };
    }

    const outcome = await this.ledger.transact(async (uow) => {
      const invoice = await this.repo.getInvoice(delivery.paymentId, uow, { lock: true });
      if (!invoice || invoice.gateway !== input.gateway) {
        return { received: true, credited: false, reason: 'unknown_payment' as const };
      }
      if (invoice.status === 'paid') {
        // A credit already posted; a refund delivery reverses it, anything else is a replay.
        if (delivery.status !== 'refund') return alreadyPaid(delivery);
        const refund = await uow.post(
          depositRefundDraft(
            depositDraft(invoice.userId, {
              invoiceId: invoice.id,
              amountBdt: invoice.amountBdt,
              settings: this.settings,
            }),
          ),
        );
        await this.repo.updateInvoice(invoice.id, { status: 'refunded' }, uow);
        return { received: true, credited: false, refunded: true, refundTxnId: refund.id };
      }
      if (invoice.status !== 'pending') {
        return { received: true, credited: false, reason: `invoice_${invoice.status}` as const };
      }
      if (new Date(invoice.expiresAt).getTime() < this.clock().getTime()) {
        await this.repo.updateInvoice(invoice.id, { status: 'expired' }, uow);
        return { received: true, credited: false, reason: 'invoice_expired' as const };
      }
      if (typeof delivery.amountBdt === 'number' && delivery.amountBdt !== invoice.amountBdt) {
        // The delivery says a different amount than the invoice: never credit it.
        return { received: true, credited: false, reason: 'amount_mismatch' as const };
      }
      if (delivery.status === 'failed') {
        await this.repo.updateInvoice(invoice.id, { status: 'failed' }, uow);
        return { received: true, credited: false, reason: 'payment_failed' as const };
      }
      if (delivery.status === 'refund') {
        return { received: true, credited: false, reason: 'never_credited' as const };
      }

      // The real credit: coins are minted against the deposit sink exactly once per invoice.
      const reader = await uow.lock(
        [userAccount(invoice.userId, 'bonus')],
        [`deposit:${invoice.id}`],
      );
      const posted = await uow.post(
        depositDraft(invoice.userId, {
          invoiceId: invoice.id,
          amountBdt: invoice.amountBdt,
          settings: this.settings,
        }),
      );
      await this.repo.updateInvoice(
        invoice.id,
        { status: 'paid', depositTxnId: posted.id, paidAt: this.clock().toISOString() },
        uow,
      );
      return {
        received: true,
        credited: true,
        paymentId: invoice.id,
        coins: Number(posted.meta?.coins ?? 0),
        userId: invoice.userId,
      };
    });

    // Recorded only once handled: a crash before this logs nothing, so the gateway's retry
    // re-runs the (idempotent) credit instead of dropping money silently.
    await this.repo.insertWebhookEvent({
      gateway: input.gateway,
      eventId: delivery.eventId,
      invoiceId: delivery.paymentId,
      signatureValid,
      payload: safeJson(input.raw),
      processedAt: this.clock().toISOString(),
      createdAt: this.clock().toISOString(),
    });
    return outcome as Record<string, unknown>;
  }

  /**
   * Development helper: the mock checkout page calls this as if the gateway had accepted the
   * payment. It walks the same signed-webhook path a real gateway would, so the credit logic
   * under test is the one that ships.
   */
  async simulateCheckout(
    invoiceId: string,
    outcome: 'paid' | 'failed',
  ): Promise<Record<string, unknown>> {
    const invoice = await this.repo.getInvoice(invoiceId);
    if (!invoice) throw new NotFoundException(`No deposit invoice ${invoiceId}.`);
    if (this.gateway.id !== 'mock') {
      throw new ConflictException('Checkout simulation works only with the mock gateway.');
    }
    const delivery: WebhookDelivery = {
      eventId: `evt-${invoiceId}-${outcome}`,
      paymentId: invoiceId,
      status: outcome,
      amountBdt: invoice.amountBdt,
    };
    const raw = JSON.stringify(delivery);
    return this.applyWebhook({
      gateway: this.gateway.id,
      delivery,
      raw,
      signature: signWebhookBody(raw, this.options.paymentsSecret),
    });
  }

  // ---------------------------------------------------------------- redeem & convert

  /** Redeem: cash turns into bought coins at the deposit rate, `minRedeemBdt` at least. */
  async redeem(userId: string, input: { amountBdt: number; redemptionId: string }) {
    await this.wallet.ensurePlayer(userId);
    return this.ledger.transact(async (uow) => {
      const reader = await uow.lock([cashAccount(userId)], [`redeem:${input.redemptionId}`]);
      const existing = reader.findByKey(`redeem:${input.redemptionId}`);
      if (existing) {
        return {
          amountBdt: Number(existing.meta?.amountBdt ?? input.amountBdt),
          coins: Number(existing.meta?.coins ?? 0),
          duplicate: true,
        };
      }
      const { draft, coins } = redeemDraft(reader, {
        redemptionId: input.redemptionId,
        userId,
        amountBdt: input.amountBdt,
        settings: this.settings,
      });
      const posted = await uow.post(draft);
      return { amountBdt: input.amountBdt, coins, txnId: posted.id, duplicate: false };
    });
  }

  /** Coin to cash: won coins convert at the stricter house rate; leftover coins stay won. */
  async convertCoinsToCash(userId: string, input: { coins: number; conversionId: string }) {
    await this.wallet.ensurePlayer(userId);
    return this.ledger.transact(async (uow) => {
      const reader = await uow.lock(
        [userAccount(userId, 'winnings'), cashAccount(userId)],
        [`coin_to_cash:${input.conversionId}`],
      );
      const existing = reader.findByKey(`coin_to_cash:${input.conversionId}`);
      if (existing) {
        return {
          coins: Number(existing.meta?.coins ?? input.coins),
          cashBdt: Number(existing.meta?.cashBdt ?? 0),
          duplicate: true,
        };
      }
      const { draft, cashBdt } = coinToCashDraft(reader, {
        conversionId: input.conversionId,
        userId,
        coins: input.coins,
        settings: this.settings,
      });
      const posted = await uow.post(draft);
      return { coins: input.coins, cashBdt, txnId: posted.id, duplicate: false };
    });
  }

  // ---------------------------------------------------------------- withdrawals

  /**
   * A cash-out request: validated, ID-gated, and held in the same breath — the taka leaves the
   * player's balance immediately and waits for an operator's decision.
   */
  async requestWithdrawal(
    userId: string,
    input: { amountBdt: number; channel: PayoutChannel; destination: string; requestId: string },
  ): Promise<WithdrawalRecord> {
    const profile = await this.wallet.ensurePlayer(userId);
    if (!profile.idVerifiedAt) {
      throw new WalletError('not_verified', 'Verify your ID before requesting a cash out.');
    }
    return this.ledger.transact(async (uow) => {
      const key = `withdraw_hold:${input.requestId}`;
      const reader = await uow.lock([cashAccount(userId)], [key]);
      if (reader.findByKey(key)) {
        const record = await this.repo.getWithdrawal(input.requestId, uow);
        if (record) return record;
      }
      // withdrawHoldDraft validates limits, channel and destination against the balance.
      const hold = await uow.post(
        withdrawHoldDraft(
          reader,
          {
            requestId: input.requestId,
            userId,
            amountBdt: input.amountBdt,
            channel: input.channel,
            destination: input.destination,
          },
          this.settings,
        ),
      );
      const record: WithdrawalRecord = {
        id: input.requestId,
        userId,
        amountBdt: input.amountBdt,
        channel: input.channel,
        destination: input.destination,
        status: 'pending',
        holdTxnId: hold.id,
        releaseTxnId: null,
        paidTxnId: null,
        payoutReference: null,
        reviewReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: this.clock().toISOString(),
      };
      await this.repo.insertWithdrawal(record, uow);
      return record;
    });
  }

  async myWithdrawals(userId: string): Promise<WithdrawalRecord[]> {
    await this.wallet.ensurePlayer(userId);
    return this.repo.withdrawalsOfUser(userId);
  }

  /**
   * The operator's review. `approve` clears the request to pay; `paid` books the taka as sent
   * and requires the e-wallet reference; `reject` and `fail` flow the hold back. Everything
   * runs with the row locked, so racing reviews cannot double-move the money.
   */
  async reviewWithdrawal(
    requestId: string,
    input: {
      action: 'approve' | 'paid' | 'reject' | 'fail';
      payoutReference?: string;
      reason?: string;
      operator?: string;
    },
  ): Promise<WithdrawalRecord> {
    return this.ledger.transact(async (uow) => {
      const w = await this.repo.getWithdrawal(requestId, uow, { lock: true });
      if (!w) throw new NotFoundException(`No cash-out request ${requestId}.`);
      if (FINAL_STATUSES.includes(w.status)) {
        throw new WalletError(
          'not_reviewable',
          `Cash-out ${requestId} is already ${w.status}; nothing left to review.`,
        );
      }
      const patch = {
        reviewedBy: input.operator ?? 'admin',
        reviewedAt: this.clock().toISOString(),
      };
      if (input.action === 'approve') {
        await this.repo.updateWithdrawal(requestId, { status: 'approved', ...patch }, uow);
      } else if (input.action === 'paid') {
        const posted = await uow.post(
          withdrawPaidDraft({
            requestId,
            userId: w.userId,
            amountBdt: w.amountBdt,
            payoutReference: requireReference(input.payoutReference, requestId),
          }),
        );
        await this.repo.updateWithdrawal(
          requestId,
          {
            status: 'paid',
            paidTxnId: posted.id,
            payoutReference: input.payoutReference,
            ...patch,
          },
          uow,
        );
      } else {
        const posted = await uow.post(
          withdrawReleaseDraft({
            requestId,
            userId: w.userId,
            amountBdt: w.amountBdt,
            reason: input.reason,
          }),
        );
        await this.repo.updateWithdrawal(
          requestId,
          {
            status: input.action === 'reject' ? 'rejected' : 'failed',
            releaseTxnId: posted.id,
            reviewReason: input.reason ?? null,
            ...patch,
          },
          uow,
        );
      }
      // Read back inside the same unit, so the row's final state is what we return.
      return (await this.repo.getWithdrawal(requestId, uow))!;
    });
  }

  /** The review queue with the user info an operator needs to make the payout. */
  async adminWithdrawals(statuses: readonly WithdrawalStatus[]) {
    const wanted = statuses.length > 0 ? statuses : OPEN_STATUSES;
    const rows = await this.repo.withdrawalsByStatus(wanted);
    const items = await Promise.all(rows.map(async (w) => this.withUserInfo(w)));
    return { count: items.length, items };
  }

  private async withUserInfo(w: WithdrawalRecord) {
    const [profile, phone] = await Promise.all([
      this.repo.getPlayer(w.userId),
      this.repo.phoneForUser(w.userId),
    ]);
    return {
      ...w,
      user: {
        id: w.userId,
        phone,
        verified: (profile?.idVerifiedAt ?? null) !== null,
        memberSince: profile?.createdAt ?? null,
        birthDate: profile?.birthDate ?? null,
      },
    };
  }
}

function alreadyPaid(delivery: WebhookDelivery): Record<string, unknown> {
  return {
    received: true,
    credited: false,
    reason: delivery.status === 'refund' ? 'refund_after_paid' : 'already_paid',
  };
}

function requireReference(reference: string | undefined, requestId: string): string {
  if (!reference) {
    throw new ConflictException({
      error: 'invalid_payout',
      message: `Record the e-wallet or bank reference when marking cash-out ${requestId} paid.`,
    });
  }
  return reference;
}

/** Parses what was sent for storage; a broken delivery's bytes are kept as a raw string. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}
