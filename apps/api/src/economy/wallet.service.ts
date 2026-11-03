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
import { CLOCK, ECONOMY_STORES, LEDGER_STORE, type Clock } from '../common/tokens';
import type { EconomyStores, PlayerProfile } from './stores';

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
    @Inject(ECONOMY_STORES) private readonly stores: EconomyStores,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Creates the player on first sight and pays the 500-coin sign-up bonus exactly once. */
  async ensurePlayer(userId: string): Promise<PlayerProfile> {
    const existing = this.stores.players.get(userId);
    if (existing) return existing;
    return this.ledger.transact(async (uow) => {
      await uow.post(signUpBonus(userId));
      const profile: PlayerProfile = this.stores.players.get(userId) ?? {
        id: userId,
        createdAt: this.clock().toISOString(),
        birthDate: null,
        idVerifiedAt: null,
        idDocumentHash: null,
        redemptionsBlocked: false,
        lastCheckIn: null,
      };
      this.stores.players.set(userId, profile);
      return profile;
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
    const txn = await this.ledger.transact(async (uow) => {
      const posted = await uow.post(dailyCheckIn(userId, today, next.streak));
      profile.lastCheckIn = { date: today, streak: next.streak };
      return posted;
    });
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
    for (const other of this.stores.players.values()) {
      if (other.id !== userId && other.idDocumentHash === hash) {
        throw new ConflictException({
          error: 'identity_in_use',
          message: 'This ID is already verified on another account.',
        });
      }
    }
    profile.birthDate = input.birthDate;
    profile.idDocumentHash = hash;
    profile.idVerifiedAt = this.clock().toISOString();
    return { verified: true, birthDate: profile.birthDate, verifiedAt: profile.idVerifiedAt };
  }
}
