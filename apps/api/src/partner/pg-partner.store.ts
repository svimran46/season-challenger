import type { VoucherCategory, VoucherDiscount } from '@season/wallet';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { partnerSession, partnerStaff, voucher, voucherOffer, voucherPartner } from '../db/schema';
import type {
  AcceptedPage,
  MarkUsedInput,
  PartnerStore,
  PartnerVoucher,
  StaffRecord,
} from './partner.store';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Selects the columns a partner may know. The holder's user id is deliberately not one of them. */
const VOUCHER_COLUMNS = {
  id: voucher.id,
  code: voucher.code,
  partnerId: voucher.partnerId,
  title: voucher.title,
  terms: voucherOffer.terms,
  discount: voucher.discount,
  expiresAt: voucher.expiresAt,
  usedAt: voucher.usedAt,
  usedReference: voucher.usedReference,
  usedByStaffName: partnerStaff.name,
  usedRequestId: voucher.usedRequestId,
  cancelledAt: voucher.cancelledAt,
};

interface VoucherRow {
  id: string;
  code: string;
  partnerId: string;
  title: string;
  terms: string;
  discount: unknown;
  expiresAt: Date;
  usedAt: Date | null;
  usedReference: string | null;
  usedByStaffName: string | null;
  usedRequestId: string | null;
  cancelledAt: Date | null;
}

const toPartnerVoucher = (row: VoucherRow): PartnerVoucher => ({
  ...row,
  discount: row.discount as VoucherDiscount,
  expiresAt: row.expiresAt.toISOString(),
  usedAt: iso(row.usedAt),
  cancelledAt: iso(row.cancelledAt),
});

/** Postgres reports a broken unique rule as 23505; Drizzle may wrap the driver's error. */
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null | undefined)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown }).cause) === '23505';
}

/** Partner accounts and the partner's side of the voucher table. */
export class PgPartnerStore implements PartnerStore {
  constructor(private readonly db: Database) {}

  async findPartner(id: string) {
    const [row] = await this.db.select().from(voucherPartner).where(eq(voucherPartner.id, id));
    return row ? { id: row.id, name: row.name, category: row.category, active: row.active } : null;
  }

  async ensurePartner(partner: { id: string; name: string; category: VoucherCategory }) {
    await this.db.insert(voucherPartner).values(partner).onConflictDoNothing();
  }

  async findStaffByEmail(email: string) {
    const [row] = await this.db.select().from(partnerStaff).where(eq(partnerStaff.email, email));
    return row ? toStaff(row) : null;
  }

  async createStaff(staff: Omit<StaffRecord, 'id' | 'active'>) {
    const [row] = await this.db.insert(partnerStaff).values(staff).returning();
    return toStaff(row!);
  }

  async createSession(session: { tokenHash: string; staffId: string; expiresAt: string }) {
    await this.db.insert(partnerSession).values({
      tokenHash: session.tokenHash,
      staffId: session.staffId,
      expiresAt: new Date(session.expiresAt),
    });
  }

  async findSession(tokenHash: string) {
    const [row] = await this.db
      .select({ session: partnerSession, staff: partnerStaff, partner: voucherPartner })
      .from(partnerSession)
      .innerJoin(partnerStaff, eq(partnerStaff.id, partnerSession.staffId))
      .innerJoin(voucherPartner, eq(voucherPartner.id, partnerStaff.partnerId))
      .where(eq(partnerSession.tokenHash, tokenHash));
    if (!row) return null;
    return {
      staff: toStaff(row.staff),
      partner: {
        id: row.partner.id,
        name: row.partner.name,
        category: row.partner.category,
        active: row.partner.active,
      },
      expiresAt: row.session.expiresAt.toISOString(),
      revokedAt: iso(row.session.revokedAt),
    };
  }

  async revokeSession(tokenHash: string, at: Date) {
    await this.db
      .update(partnerSession)
      .set({ revokedAt: at })
      .where(and(eq(partnerSession.tokenHash, tokenHash), isNull(partnerSession.revokedAt)));
  }

  async findVoucher(partnerId: string, code: string) {
    const [row] = await this.vouchers().where(
      and(eq(voucher.partnerId, partnerId), eq(voucher.code, code)),
    );
    return row ? toPartnerVoucher(row) : null;
  }

  async findAcceptance(partnerId: string, requestId: string) {
    const [row] = await this.vouchers().where(
      and(eq(voucher.partnerId, partnerId), eq(voucher.usedRequestId, requestId)),
    );
    return row ? toPartnerVoucher(row) : null;
  }

  /**
   * One conditional update. If two tills race, Postgres makes the second wait for the first and
   * then re-checks the conditions on the updated row, so exactly one of them changes it.
   */
  async markUsed(input: MarkUsedInput) {
    try {
      const updated = await this.db
        .update(voucher)
        .set({
          usedAt: input.at,
          usedReference: input.reference,
          usedByStaffId: input.staffId,
          usedRequestId: input.requestId,
        })
        .where(
          and(
            eq(voucher.id, input.voucherId),
            eq(voucher.partnerId, input.partnerId),
            isNull(voucher.usedAt),
            isNull(voucher.cancelledAt),
            gt(voucher.expiresAt, input.at),
          ),
        )
        .returning({ id: voucher.id });
      return updated.length === 1;
    } catch (error) {
      // This partner already used the request id on another voucher.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async listAccepted(partnerId: string, page: AcceptedPage) {
    const accepted = and(eq(voucher.partnerId, partnerId), sql`${voucher.usedAt} is not null`);
    const rows = await this.vouchers()
      .where(
        page.after
          ? and(
              accepted,
              sql`(${voucher.usedAt}, ${voucher.code}) < (${new Date(page.after.usedAt).toISOString()}::timestamptz, ${page.after.code})`,
            )
          : accepted,
      )
      .orderBy(desc(voucher.usedAt), desc(voucher.code))
      .limit(page.limit);
    return rows.map(toPartnerVoucher);
  }

  private vouchers() {
    return this.db
      .select(VOUCHER_COLUMNS)
      .from(voucher)
      .innerJoin(voucherOffer, eq(voucherOffer.id, voucher.offerId))
      .leftJoin(partnerStaff, eq(partnerStaff.id, voucher.usedByStaffId))
      .$dynamic();
  }
}

function toStaff(row: typeof partnerStaff.$inferSelect): StaffRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    role: row.role,
    active: row.active,
  };
}
