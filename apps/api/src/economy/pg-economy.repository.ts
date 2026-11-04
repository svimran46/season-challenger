import type { SquadPick } from '@season/shared';
import {
  FORMAT_RULES,
  type LedgerUnitOfWork,
  type PrizeTier,
  type VoucherDiscount,
  type VoucherOffer,
} from '@season/wallet';
import { and, asc, desc, eq, gt, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  appUser,
  contest,
  contestEntry,
  dailyCheckIn,
  voucher,
  voucherOffer,
  voucherPartner,
} from '../db/schema';
import { executorFor } from '../ledger/pg-ledger.store';
import {
  IdentityInUseError,
  type ContestFilter,
  type ContestRecord,
  type ContestStatus,
  type EconomyRepository,
  type EntryRecord,
  type PlayerProfile,
  type VoucherRecord,
} from './stores';

type ContestRow = typeof contest.$inferSelect;
type EntryRow = typeof contestEntry.$inferSelect;
type VoucherRow = typeof voucher.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toDate = (s: string | null) => (s === null ? null : new Date(s));

/** Postgres unique_violation, whether or not drizzle wrapped the driver error. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

/** Players, tournaments, entries and vouchers in Postgres. See EconomyRepository. */
export class PgEconomyRepository implements EconomyRepository {
  constructor(private readonly db: Database) {}

  // ------------------------------------------------------------ players

  async getPlayer(id: string, uow?: LedgerUnitOfWork): Promise<PlayerProfile | undefined> {
    const ex = executorFor(this.db, uow);
    const [row] = await ex.select().from(appUser).where(eq(appUser.id, id));
    if (!row) return undefined;
    const [last] = await ex
      .select({ date: dailyCheckIn.localDate, streak: dailyCheckIn.streak })
      .from(dailyCheckIn)
      .where(eq(dailyCheckIn.userId, id))
      .orderBy(desc(dailyCheckIn.localDate))
      .limit(1);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      birthDate: row.birthDate,
      idVerifiedAt: iso(row.idVerifiedAt),
      idDocumentHash: row.idDocumentHash,
      redemptionsBlocked: row.redemptionsBlocked,
      lastCheckIn: last ? { date: last.date, streak: last.streak } : null,
    };
  }

  async createPlayer(profile: PlayerProfile, uow: LedgerUnitOfWork): Promise<PlayerProfile> {
    await executorFor(this.db, uow)
      .insert(appUser)
      .values({
        id: profile.id,
        authId: profile.id,
        displayName: null,
        birthDate: profile.birthDate,
        idVerifiedAt: toDate(profile.idVerifiedAt),
        idDocumentHash: profile.idDocumentHash,
        redemptionsBlocked: profile.redemptionsBlocked,
        createdAt: new Date(profile.createdAt),
      })
      .onConflictDoNothing({ target: appUser.id });
    return (await this.getPlayer(profile.id, uow))!;
  }

  async findPlayerByDocumentHash(hash: string): Promise<PlayerProfile | undefined> {
    const [row] = await this.db
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.idDocumentHash, hash));
    return row ? this.getPlayer(row.id) : undefined;
  }

  async recordVerification(
    id: string,
    v: { birthDate: string; idDocumentHash: string; idVerifiedAt: string },
  ): Promise<void> {
    try {
      await this.db
        .update(appUser)
        .set({
          birthDate: v.birthDate,
          idDocumentHash: v.idDocumentHash,
          idVerifiedAt: new Date(v.idVerifiedAt),
        })
        .where(eq(appUser.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityInUseError();
      throw error;
    }
  }

  async recordCheckIn(
    userId: string,
    checkIn: { date: string; streak: number; rewardTxnId: string },
    uow: LedgerUnitOfWork,
  ): Promise<void> {
    await executorFor(this.db, uow)
      .insert(dailyCheckIn)
      .values({
        userId,
        localDate: checkIn.date,
        streak: checkIn.streak,
        rewardTxnId: checkIn.rewardTxnId,
      })
      .onConflictDoNothing();
  }

  // ------------------------------------------------------------ tournaments

  async listContests(filter: ContestFilter, uow?: LedgerUnitOfWork): Promise<ContestRecord[]> {
    const where: SQL[] = [];
    if (filter.fixtureId !== undefined) where.push(eq(contest.fixtureId, filter.fixtureId));
    if (filter.templateKey !== undefined) where.push(eq(contest.templateKey, filter.templateKey));
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      where.push(inArray(contest.status, [...filter.statuses]));
    }
    const rows = await executorFor(this.db, uow)
      .select()
      .from(contest)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(asc(contest.createdAt), asc(contest.id));
    return rows.map(toContest);
  }

  async getContest(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<ContestRecord | undefined> {
    const query = executorFor(this.db, uow).select().from(contest).where(eq(contest.id, id));
    const [row] = opts?.lock ? await query.for('update') : await query;
    return row ? toContest(row) : undefined;
  }

  async contestByInviteCode(code: string): Promise<ContestRecord | undefined> {
    const [row] = await this.db.select().from(contest).where(eq(contest.inviteCode, code));
    return row ? toContest(row) : undefined;
  }

  async insertContest(record: ContestRecord, uow?: LedgerUnitOfWork): Promise<boolean> {
    const inserted = await executorFor(this.db, uow)
      .insert(contest)
      .values({
        id: record.id,
        fixtureId: record.fixtureId,
        name: record.name,
        format: record.format,
        status: record.status,
        inviteCode: record.inviteCode,
        createdBy: record.createdBy,
        templateKey: record.templateKey,
        entryFee: record.entryFee,
        capacity: record.capacity,
        minEntries: record.minEntries,
        guaranteed: record.guaranteed,
        platformFeeBps: record.platformFeeBps,
        maxBonusShareBps: record.maxBonusShareBps,
        prizeTable: record.prizeTable,
        entryCount: record.entryCount,
        createdAt: new Date(record.createdAt),
        settledAt: toDate(record.settledAt),
      })
      .onConflictDoNothing({ target: contest.id })
      .returning({ id: contest.id });
    return inserted.length > 0;
  }

  async updateContest(
    id: string,
    patch: { status: ContestStatus; settledAt?: string | null },
    uow: LedgerUnitOfWork,
  ): Promise<void> {
    await executorFor(this.db, uow)
      .update(contest)
      .set({
        status: patch.status,
        ...(patch.settledAt !== undefined ? { settledAt: toDate(patch.settledAt) } : {}),
      })
      .where(eq(contest.id, id));
  }

  async inviteCodeTaken(code: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: contest.id })
      .from(contest)
      .where(eq(contest.inviteCode, code));
    return row !== undefined;
  }

  // ------------------------------------------------------------ entries

  async getEntry(id: string, uow?: LedgerUnitOfWork): Promise<EntryRecord | undefined> {
    const [row] = await executorFor(this.db, uow)
      .select()
      .from(contestEntry)
      .where(eq(contestEntry.id, id));
    return row ? toEntry(row) : undefined;
  }

  async entriesFor(contestId: string, uow?: LedgerUnitOfWork): Promise<EntryRecord[]> {
    const rows = await executorFor(this.db, uow)
      .select()
      .from(contestEntry)
      .where(eq(contestEntry.contestId, contestId))
      .orderBy(asc(contestEntry.joinedAt), asc(contestEntry.id));
    return rows.map(toEntry);
  }

  async entriesOfUser(userId: string): Promise<EntryRecord[]> {
    const rows = await this.db
      .select()
      .from(contestEntry)
      .where(eq(contestEntry.userId, userId))
      .orderBy(desc(contestEntry.joinedAt), desc(contestEntry.id));
    return rows.map(toEntry);
  }

  async insertEntry(entry: EntryRecord, uow: LedgerUnitOfWork): Promise<void> {
    const ex = executorFor(this.db, uow);
    await ex.insert(contestEntry).values({
      id: entry.id,
      contestId: entry.contestId,
      userId: entry.userId,
      squad: entry.squad,
      entryTxnId: entry.entryTxnId,
      points: entry.points,
      rank: entry.rank,
      prize: entry.prize,
      joinedAt: new Date(entry.joinedAt),
    });
    await ex
      .update(contest)
      .set({ entryCount: sql`${contest.entryCount} + 1` })
      .where(eq(contest.id, entry.contestId));
  }

  async recordResult(
    entryId: string,
    result: { points: number; rank: number; prize: number },
    uow: LedgerUnitOfWork,
  ): Promise<void> {
    await executorFor(this.db, uow)
      .update(contestEntry)
      .set({ points: result.points, rank: result.rank, prize: result.prize })
      .where(eq(contestEntry.id, entryId));
  }

  // ------------------------------------------------------------ vouchers

  async upsertOffers(offers: readonly VoucherOffer[]): Promise<void> {
    if (offers.length === 0) return;
    await this.db.transaction(async (tx) => {
      const partners = new Map(offers.map((o) => [o.partnerId, o]));
      await tx
        .insert(voucherPartner)
        .values(
          [...partners.values()].map((o) => ({
            id: o.partnerId,
            name: o.partnerName,
            category: o.category,
          })),
        )
        .onConflictDoUpdate({
          target: voucherPartner.id,
          set: { name: sql.raw('excluded.name'), category: sql.raw('excluded.category') },
        });
      await tx
        .insert(voucherOffer)
        .values(
          offers.map((o) => ({
            id: o.id,
            partnerId: o.partnerId,
            category: o.category,
            title: o.title,
            terms: o.terms,
            costCoins: o.costCoins,
            discount: o.discount,
            validForDays: o.validForDays,
            stock: o.stock,
            perUserMonthlyLimit: o.perUserMonthlyLimit,
            availableFrom: new Date(o.availableFrom),
            availableUntil: toDate(o.availableUntil),
            active: o.active,
          })),
        )
        .onConflictDoUpdate({
          target: voucherOffer.id,
          // Everything but stock: what is left is the live count, not the catalogue's.
          set: {
            partnerId: sql.raw('excluded.partner_id'),
            category: sql.raw('excluded.category'),
            title: sql.raw('excluded.title'),
            terms: sql.raw('excluded.terms'),
            costCoins: sql.raw('excluded.cost_coins'),
            discount: sql.raw('excluded.discount'),
            validForDays: sql.raw('excluded.valid_for_days'),
            perUserMonthlyLimit: sql.raw('excluded.per_user_monthly_limit'),
            availableFrom: sql.raw('excluded.available_from'),
            availableUntil: sql.raw('excluded.available_until'),
            active: sql.raw('excluded.active'),
          },
        });
    });
  }

  async listOffers(): Promise<VoucherOffer[]> {
    const rows = await this.offerQuery(this.db).orderBy(asc(voucherOffer.id));
    return rows.map(toOffer);
  }

  async getOffer(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<VoucherOffer | undefined> {
    const query = this.offerQuery(executorFor(this.db, uow)).where(eq(voucherOffer.id, id));
    const [row] = opts?.lock ? await query.for('update', { of: voucherOffer }) : await query;
    return row ? toOffer(row) : undefined;
  }

  async decrementStock(offerId: string, uow: LedgerUnitOfWork): Promise<void> {
    const updated = await executorFor(this.db, uow)
      .update(voucherOffer)
      .set({ stock: sql`${voucherOffer.stock} - 1` })
      .where(and(eq(voucherOffer.id, offerId), gt(voucherOffer.stock, 0)))
      .returning({ id: voucherOffer.id });
    if (updated.length === 0) throw new Error(`Offer ${offerId} has no stock to take.`);
  }

  async getVoucher(id: string, uow?: LedgerUnitOfWork): Promise<VoucherRecord | undefined> {
    const [row] = await executorFor(this.db, uow).select().from(voucher).where(eq(voucher.id, id));
    return row ? toVoucher(row) : undefined;
  }

  async voucherCodeTaken(code: string, uow?: LedgerUnitOfWork): Promise<boolean> {
    const [row] = await executorFor(this.db, uow)
      .select({ id: voucher.id })
      .from(voucher)
      .where(eq(voucher.code, code));
    return row !== undefined;
  }

  async insertVoucher(record: VoucherRecord, uow: LedgerUnitOfWork): Promise<void> {
    await executorFor(this.db, uow)
      .insert(voucher)
      .values({
        id: record.id,
        code: record.code,
        userId: record.userId,
        offerId: record.offerId,
        partnerId: record.partnerId,
        partnerName: record.partnerName,
        category: record.category,
        title: record.title,
        discount: record.discount,
        costCoins: record.costCoins,
        issuedAt: new Date(record.issuedAt),
        expiresAt: new Date(record.expiresAt),
        usedAt: toDate(record.usedAt),
        usedReference: record.usedReference,
        cancelledAt: toDate(record.cancelledAt),
        redemptionTxnId: record.redemptionTxnId,
      });
  }

  async vouchersOfUser(
    userId: string,
    opts?: { since?: string },
    uow?: LedgerUnitOfWork,
  ): Promise<VoucherRecord[]> {
    const where = [eq(voucher.userId, userId)];
    if (opts?.since) where.push(gte(voucher.issuedAt, new Date(opts.since)));
    const rows = await executorFor(this.db, uow)
      .select()
      .from(voucher)
      .where(and(...where))
      .orderBy(desc(voucher.issuedAt), desc(voucher.id));
    return rows.map(toVoucher);
  }

  private offerQuery(ex: ReturnType<typeof executorFor>) {
    return ex
      .select({ offer: voucherOffer, partnerName: voucherPartner.name })
      .from(voucherOffer)
      .innerJoin(voucherPartner, eq(voucherPartner.id, voucherOffer.partnerId))
      .$dynamic();
  }
}

function toContest(row: ContestRow): ContestRecord {
  return {
    id: row.id,
    format: row.format,
    inviteOnly: FORMAT_RULES[row.format].inviteOnly,
    entryFee: row.entryFee,
    capacity: row.capacity,
    minEntries: row.minEntries,
    guaranteed: row.guaranteed,
    platformFeeBps: row.platformFeeBps,
    maxBonusShareBps: row.maxBonusShareBps,
    prizeTable: row.prizeTable as PrizeTier[],
    fixtureId: row.fixtureId,
    name: row.name,
    status: row.status,
    inviteCode: row.inviteCode,
    createdBy: row.createdBy,
    templateKey: row.templateKey,
    entryCount: row.entryCount,
    createdAt: row.createdAt.toISOString(),
    settledAt: iso(row.settledAt),
  };
}

function toEntry(row: EntryRow): EntryRecord {
  return {
    id: row.id,
    contestId: row.contestId,
    userId: row.userId,
    squad: row.squad as SquadPick,
    entryTxnId: row.entryTxnId,
    points: row.points,
    rank: row.rank,
    prize: row.prize,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function toOffer(row: {
  offer: typeof voucherOffer.$inferSelect;
  partnerName: string;
}): VoucherOffer {
  const o = row.offer;
  return {
    id: o.id,
    partnerId: o.partnerId,
    partnerName: row.partnerName,
    category: o.category,
    title: o.title,
    terms: o.terms,
    costCoins: o.costCoins,
    discount: o.discount as VoucherDiscount,
    validForDays: o.validForDays,
    stock: o.stock,
    perUserMonthlyLimit: o.perUserMonthlyLimit,
    availableFrom: o.availableFrom.toISOString(),
    availableUntil: iso(o.availableUntil),
    active: o.active,
  };
}

function toVoucher(row: VoucherRow): VoucherRecord {
  return {
    id: row.id,
    code: row.code,
    userId: row.userId,
    offerId: row.offerId,
    partnerId: row.partnerId,
    partnerName: row.partnerName,
    category: row.category,
    title: row.title,
    discount: row.discount as VoucherDiscount,
    costCoins: row.costCoins,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: iso(row.usedAt),
    usedReference: row.usedReference,
    cancelledAt: iso(row.cancelledAt),
    redemptionTxnId: row.redemptionTxnId,
  };
}
