import { randomUUID } from 'node:crypto';
import type { VoucherCategory } from '@season/wallet';
import type { MemoryEconomyRepository } from '../economy/memory-economy.repository';
import type { VoucherRecord } from '../economy/stores';
import type {
  AcceptedPage,
  MarkUsedInput,
  PartnerRecord,
  PartnerStore,
  PartnerVoucher,
  SessionRecord,
  StaffRecord,
} from './partner.store';

/**
 * Partner accounts in memory for development and tests. Vouchers stay in the in-memory economy
 * repository; who accepted one is kept here rather than on VoucherRecord.
 */
export class MemoryPartnerStore implements PartnerStore {
  private readonly partners = new Map<string, PartnerRecord>();
  private readonly staff = new Map<string, StaffRecord>();
  private readonly sessions = new Map<
    string,
    { staffId: string; expiresAt: string; revokedAt: string | null }
  >();
  private readonly acceptances = new Map<string, { staffName: string; requestId: string }>();

  constructor(private readonly economy: MemoryEconomyRepository) {}

  async findPartner(id: string) {
    return this.partners.get(id) ?? null;
  }

  async ensurePartner(partner: { id: string; name: string; category: VoucherCategory }) {
    if (!this.partners.has(partner.id)) this.partners.set(partner.id, { ...partner, active: true });
  }

  async findStaffByEmail(email: string) {
    return [...this.staff.values()].find((s) => s.email === email) ?? null;
  }

  async createStaff(staff: Omit<StaffRecord, 'id' | 'active'>) {
    const record: StaffRecord = { ...staff, id: randomUUID(), active: true };
    this.staff.set(record.id, record);
    return record;
  }

  async createSession(session: { tokenHash: string; staffId: string; expiresAt: string }) {
    this.sessions.set(session.tokenHash, {
      staffId: session.staffId,
      expiresAt: session.expiresAt,
      revokedAt: null,
    });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    const staff = session && this.staff.get(session.staffId);
    const partner = staff && this.partners.get(staff.partnerId);
    if (!session || !staff || !partner) return null;
    return { staff, partner, expiresAt: session.expiresAt, revokedAt: session.revokedAt };
  }

  async revokeSession(tokenHash: string, at: Date) {
    const session = this.sessions.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = at.toISOString();
  }

  // ---------------------------------------------------------------- vouchers

  async findVoucher(partnerId: string, code: string) {
    const found = this.economy
      .voucherRecords()
      .find((v) => v.code === code && v.partnerId === partnerId);
    return found ? this.toPartnerVoucher(found) : null;
  }

  async findAcceptance(partnerId: string, requestId: string) {
    for (const [voucherId, acceptance] of this.acceptances) {
      const voucher = this.economy.voucherRecords().find((v) => v.id === voucherId);
      if (voucher?.partnerId === partnerId && acceptance.requestId === requestId) {
        return this.toPartnerVoucher(voucher);
      }
    }
    return null;
  }

  async markUsed(input: MarkUsedInput) {
    const voucher = this.economy.voucherRecords().find((v) => v.id === input.voucherId);
    const staff = this.staff.get(input.staffId);
    if (!voucher || !staff || voucher.partnerId !== input.partnerId) return false;
    if (voucher.usedAt || voucher.cancelledAt) return false;
    if (input.at.getTime() >= Date.parse(voucher.expiresAt)) return false;
    if (await this.findAcceptance(input.partnerId, input.requestId)) return false;
    this.economy.markVoucherUsed(voucher.id, input.at.toISOString(), input.reference);
    this.acceptances.set(voucher.id, { staffName: staff.name, requestId: input.requestId });
    return true;
  }

  async listAccepted(partnerId: string, page: AcceptedPage) {
    const accepted = this.economy
      .voucherRecords()
      .filter((v) => v.partnerId === partnerId && v.usedAt)
      .sort((a, b) => b.usedAt!.localeCompare(a.usedAt!) || (a.code < b.code ? 1 : -1));
    const after = page.after;
    const rest = after
      ? accepted.filter(
          (v) => v.usedAt! < after.usedAt || (v.usedAt === after.usedAt && v.code < after.code),
        )
      : accepted;
    return rest.slice(0, page.limit).map((v) => this.toPartnerVoucher(v));
  }

  private toPartnerVoucher(v: VoucherRecord): PartnerVoucher {
    const acceptance = this.acceptances.get(v.id);
    return {
      id: v.id,
      code: v.code,
      partnerId: v.partnerId,
      title: v.title,
      terms: this.economy.offerTerms(v.offerId),
      discount: v.discount,
      expiresAt: v.expiresAt,
      usedAt: v.usedAt,
      usedReference: v.usedReference,
      usedByStaffName: acceptance?.staffName ?? null,
      usedRequestId: acceptance?.requestId ?? null,
      cancelledAt: v.cancelledAt,
    };
  }
}
