import type { VoucherCategory, VoucherDiscount } from '@season/wallet';

export type PartnerStaffRole = 'owner' | 'cashier';

export interface PartnerRecord {
  id: string;
  name: string;
  category: VoucherCategory;
  active: boolean;
}

export interface StaffRecord {
  id: string;
  partnerId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: PartnerStaffRole;
  active: boolean;
}

export interface SessionRecord {
  staff: StaffRecord;
  partner: PartnerRecord;
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * A voucher as a partner may know it. It has no user id, birth date or phone, so no view built on
 * it can leak who the holder is. `id` is only for computing the present code; views leave it out.
 */
export interface PartnerVoucher {
  id: string;
  code: string;
  partnerId: string;
  title: string;
  terms: string;
  discount: VoucherDiscount;
  expiresAt: string;
  usedAt: string | null;
  usedReference: string | null;
  usedByStaffName: string | null;
  usedRequestId: string | null;
  cancelledAt: string | null;
}

export interface MarkUsedInput {
  voucherId: string;
  partnerId: string;
  staffId: string;
  reference: string;
  requestId: string;
  at: Date;
}

/** Newest first; `after` is the last voucher of the previous page. */
export interface AcceptedPage {
  limit: number;
  after?: { usedAt: string; code: string };
}

export interface PartnerStore {
  findPartner(id: string): Promise<PartnerRecord | null>;
  /** Adds the partner if it is new; an existing one keeps its details. */
  ensurePartner(partner: { id: string; name: string; category: VoucherCategory }): Promise<void>;

  /** `email` is lower case. */
  findStaffByEmail(email: string): Promise<SessionRecord['staff'] | null>;
  createStaff(staff: Omit<StaffRecord, 'id' | 'active'>): Promise<StaffRecord>;

  createSession(session: { tokenHash: string; staffId: string; expiresAt: string }): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string, at: Date): Promise<void>;

  /** Only ever finds this partner's own vouchers. `code` is in canonical form. */
  findVoucher(partnerId: string, code: string): Promise<PartnerVoucher | null>;
  /** The voucher this partner already accepted under this request id, if any. */
  findAcceptance(partnerId: string, requestId: string): Promise<PartnerVoucher | null>;
  /**
   * Atomic single use: true if this call moved the voucher from unused to used. False if it was
   * used, cancelled or expired by then, or this partner already used the request id elsewhere.
   */
  markUsed(input: MarkUsedInput): Promise<boolean>;
  /** At most `limit` of this partner's accepted vouchers, newest first. */
  listAccepted(partnerId: string, page: AcceptedPage): Promise<PartnerVoucher[]>;
}
