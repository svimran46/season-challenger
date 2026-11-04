import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  dailyCheckIn,
  dailyCheckInAmount,
  dhakaDate,
  isCalendarDate,
  nextStreak,
  signUpBonus,
  userAccount,
  type LedgerStore,
  type Transaction,
} from '@season/wallet';
import { createHmac } from 'node:crypto';
import { CLOCK, ECONOMY_REPOSITORY, LEDGER_STORE, type Clock } from '../common/tokens';
import { IdentityInUseError, type EconomyRepository, type PlayerProfile } from './stores';

export const userAccounts = (userId: string) => [
  userAccount(userId, 'bonus'),
  userAccount(userId, 'winnings'),
];

export interface WalletActivity {
  id: string;
  kind: Transaction['kind'];
  createdAt: string;
  /** Net change to this user's coins, split by balance. */
  bonus: number;
  winnings: number;
  meta: Record<string, string | number>;
}

@Injectable()
export class WalletService {
  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_REPOSITORY) private readonly repo: EconomyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Creates the player on first sight and pays the 500-coin sign-up bonus exactly once. */
  async ensurePlayer(userId: string): Promise<PlayerProfile> {
    const existing = await this.repo.getPlayer(userId);
    if (existing) return existing;
    return this.ledger.transact(async (uow) => {
      await uow.post(signUpBonus(userId));
      return this.repo.createPlayer(
        {
          id: userId,
          createdAt: this.clock().toISOString(),
          birthDate: null,
          idVerifiedAt: null,
          idDocumentHash: null,
          redemptionsBlocked: false,
          lastCheckIn: null,
        },
        uow,
      );
    });
  }

  async wallet(userId: string) {
    const profile = await this.ensurePlayer(userId);
    const [bonus, winnings] = await Promise.all(
      userAccounts(userId).map((a) => this.ledger.balance(a)),
    );
    const today = dhakaDate(this.clock());
    const next = nextStreak(profile.lastCheckIn, today);
    return {
      bonus,
      winnings,
      total: bonus! + winnings!,
      /** Only won coins can be redeemed for vouchers. */
      redeemable: winnings,
      checkIn: {
        today,
        checkedIn: next.alreadyCheckedIn,
        streak: next.alreadyCheckedIn ? next.streak : (profile.lastCheckIn?.streak ?? 0),
        nextReward: next.alreadyCheckedIn ? 0 : dailyCheckInAmount(next.streak),
      },
      verified: profile.idVerifiedAt !== null,
    };
  }

  /** The daily reward: once per Dhaka calendar day, with a bonus every seventh day running. */
  async checkIn(userId: string) {
    const profile = await this.ensurePlayer(userId);
    const today = dhakaDate(this.clock());
    const next = nextStreak(profile.lastCheckIn, today);
    if (next.alreadyCheckedIn) {
      return { today, streak: next.streak, coins: 0, alreadyCheckedIn: true };
    }
    const draft = dailyCheckIn(userId, today, next.streak);
    const txn = await this.ledger.transact(async (uow) => {
      // A check-in racing this one may have paid today's reward since we read the profile.
      const reader = await uow.lock(userAccounts(userId), [draft.idempotencyKey]);
      if (reader.findByKey(draft.idempotencyKey)) return null;
      const posted = await uow.post(draft);
      await this.repo.recordCheckIn(
        userId,
        { date: today, streak: next.streak, rewardTxnId: posted.id },
        uow,
      );
      return posted;
    });
    if (!txn) return { today, streak: next.streak, coins: 0, alreadyCheckedIn: true };
    const coins = txn.postings.find((p) => p.account === userAccount(userId, 'bonus'))!.amount;
    return { today, streak: next.streak, coins, alreadyCheckedIn: false };
  }

  async activity(userId: string, limit: number): Promise<WalletActivity[]> {
    await this.ensurePlayer(userId);
    const history = await this.ledger.history(userAccounts(userId), limit);
    const amountOn = (t: Transaction, account: string) =>
      t.postings.find((p) => p.account === account)?.amount ?? 0;
    return history.map((t) => ({
      id: t.id,
      kind: t.kind,
      createdAt: t.createdAt,
      bonus: amountOn(t, userAccount(userId, 'bonus')),
      winnings: amountOn(t, userAccount(userId, 'winnings')),
      meta: t.meta ?? {},
    }));
  }

  /**
   * Development stand-in for the ID-check provider's callback. The document number is stored
   * only as a keyed hash, and one document can verify one account.
   */
  async recordVerification(userId: string, input: { birthDate: string; documentNumber: string }) {
    const profile = await this.ensurePlayer(userId);
    if (!isCalendarDate(input.birthDate)) throw new ConflictException('Bad birth date.');
    const secret = process.env.ID_HASH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('ID_HASH_SECRET must be set in production.');
    }
    const hash = createHmac('sha256', secret ?? 'dev-only-secret')
      .update(input.documentNumber.replace(/\s+/g, '').toUpperCase())
      .digest('hex');
    const verifiedAt = this.clock().toISOString();
    try {
      await this.repo.recordVerification(profile.id, {
        birthDate: input.birthDate,
        idDocumentHash: hash,
        idVerifiedAt: verifiedAt,
      });
    } catch (error) {
      if (!(error instanceof IdentityInUseError)) throw error;
      throw new ConflictException({ error: 'identity_in_use', message: error.message });
    }
    return { verified: true, birthDate: input.birthDate, verifiedAt };
  }
}
