import type { SquadPick } from '@season/shared';
import type {
  ContestSetup,
  IssuedVoucher,
  LedgerUnitOfWork,
  PayoutChannel,
  VoucherOffer,
  WithdrawalStatus,
} from '@season/wallet';

/*
 * Players, tournaments, entries and vouchers. EconomyRepository is the storage port the economy
 * services use; MemoryEconomyRepository (memory-economy.repository.ts) backs development and
 * tests, PgEconomyRepository (pg-economy.repository.ts) backs the API when DATABASE_URL is set.
 *
 * Writes that must commit with coins take the ledger unit of work as `uow`: the Postgres
 * repository runs them in the same database transaction as the ledger postings. Reads without
 * `uow` see committed data.
 */

export interface PlayerProfile {
  id: string;
  createdAt: string;
  birthDate: string | null;
  idVerifiedAt: string | null;
  idDocumentHash: string | null;
  redemptionsBlocked: boolean;
  /** The latest daily check-in, which drives the streak. */
  lastCheckIn: { date: string; streak: number } | null;
}

export type ContestStatus = 'open' | 'locked' | 'settled' | 'cancelled';

export interface ContestRecord extends ContestSetup {
  fixtureId: string;
  name: string;
  status: ContestStatus;
  inviteCode: string | null;
  createdBy: string | null;
  /** Public tournaments spawn a fresh copy from this template when they fill. */
  templateKey: string | null;
  /** Entries so far; kept by insertEntry. */
  entryCount: number;
  createdAt: string;
  settledAt: string | null;
}

export interface EntryRecord {
  /** <contestId>:<userId>; the ledger key is entry:<id>. */
  id: string;
  contestId: string;
  userId: string;
  squad: SquadPick;
  entryTxnId: string;
  points: number | null;
  rank: number | null;
  prize: number | null;
  joinedAt: string;
}

export interface VoucherRecord extends IssuedVoucher {
  usedAt: string | null;
  usedReference: string | null;
  cancelledAt: string | null;
  redemptionTxnId: string;
}

/** Life of a deposit invoice: pending until a webhook settles it, then final. */
export type DepositStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

/** A checkout created for the player; the coins become theirs only once a webhook says paid. */
export interface DepositInvoiceRecord {
  id: string;
  userId: string;
  gateway: string;
  channel: PayoutChannel;
  amountBdt: number;
  coins: number;
  status: DepositStatus;
  checkoutUrl: string | null;
  /** The credit transaction, set when the webhook marks the invoice paid. */
  depositTxnId: string | null;
  paidAt: string | null;
  createdAt: string;
  expiresAt: string;
}

/** A cash-out request; cash stays held from creation until the review releases or pays it. */
export interface WithdrawalRecord {
  id: string;
  userId: string;
  amountBdt: number;
  channel: PayoutChannel;
  destination: string;
  status: WithdrawalStatus;
  holdTxnId: string;
  releaseTxnId: string | null;
  paidTxnId: string | null;
  payoutReference: string | null;
  reviewReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** One gateway delivery; stored only after it has been handled, for the audit trail. */
export interface WebhookEventRecord {
  gateway: string;
  eventId: string;
  invoiceId: string | null;
  signatureValid: boolean;
  payload: unknown;
  processedAt: string | null;
  createdAt: string;
}

export interface ContestFilter {
  fixtureId?: string;
  statuses?: readonly ContestStatus[];
  templateKey?: string;
}

export interface EconomyRepository {
  // ------------------------------------------------------------ players
  getPlayer(id: string, uow?: LedgerUnitOfWork): Promise<PlayerProfile | undefined>;
  /** Inserts the player unless they exist; returns the stored profile either way. */
  createPlayer(profile: PlayerProfile, uow: LedgerUnitOfWork): Promise<PlayerProfile>;
  /** The player whose verified ID document has this keyed hash. */
  findPlayerByDocumentHash(hash: string): Promise<PlayerProfile | undefined>;
  /**
   * Records a passed ID check. Throws IdentityInUseError if another account holds the hash
   * (the database enforces this with a unique index).
   */
  recordVerification(
    id: string,
    v: { birthDate: string; idDocumentHash: string; idVerifiedAt: string },
  ): Promise<void>;
  recordCheckIn(
    userId: string,
    checkIn: { date: string; streak: number; rewardTxnId: string },
    uow: LedgerUnitOfWork,
  ): Promise<void>;

  // ------------------------------------------------------------ tournaments
  listContests(filter: ContestFilter, uow?: LedgerUnitOfWork): Promise<ContestRecord[]>;
  /** With `lock`, holds the row (SELECT ... FOR UPDATE) until `uow` commits. */
  getContest(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<ContestRecord | undefined>;
  contestByInviteCode(code: string): Promise<ContestRecord | undefined>;
  /** Inserts unless the id exists (public ids are deterministic); true if this call inserted. */
  insertContest(record: ContestRecord, uow?: LedgerUnitOfWork): Promise<boolean>;
  updateContest(
    id: string,
    patch: { status: ContestStatus; settledAt?: string | null },
    uow: LedgerUnitOfWork,
  ): Promise<void>;
  inviteCodeTaken(code: string): Promise<boolean>;

  // ------------------------------------------------------------ entries
  getEntry(id: string, uow?: LedgerUnitOfWork): Promise<EntryRecord | undefined>;
  entriesFor(contestId: string, uow?: LedgerUnitOfWork): Promise<EntryRecord[]>;
  /** Newest first. */
  entriesOfUser(userId: string): Promise<EntryRecord[]>;
  /** Also adds one to the contest's entryCount. */
  insertEntry(entry: EntryRecord, uow: LedgerUnitOfWork): Promise<void>;
  recordResult(
    entryId: string,
    result: { points: number; rank: number; prize: number },
    uow: LedgerUnitOfWork,
  ): Promise<void>;

  // ------------------------------------------------------------ vouchers
  /** Saves partners and offers from a catalogue; existing offers keep their remaining stock. */
  upsertOffers(offers: readonly VoucherOffer[]): Promise<void>;
  listOffers(): Promise<VoucherOffer[]>;
  /** With `lock`, holds the offer row so the last unit of stock cannot be issued twice. */
  getOffer(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<VoucherOffer | undefined>;
  decrementStock(offerId: string, uow: LedgerUnitOfWork): Promise<void>;
  getVoucher(id: string, uow?: LedgerUnitOfWork): Promise<VoucherRecord | undefined>;
  voucherCodeTaken(code: string, uow?: LedgerUnitOfWork): Promise<boolean>;
  insertVoucher(record: VoucherRecord, uow: LedgerUnitOfWork): Promise<void>;
  /** Newest first. With `since`, only vouchers issued at or after it. */
  vouchersOfUser(
    userId: string,
    opts?: { since?: string },
    uow?: LedgerUnitOfWork,
  ): Promise<VoucherRecord[]>;

  // ------------------------------------------------------------ money
  /** With `lock`, holds the invoice row until `uow` commits, so webhooks settle once. */
  getInvoice(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<DepositInvoiceRecord | undefined>;
  /** Newest first. */
  invoicesOfUser(userId: string): Promise<DepositInvoiceRecord[]>;
  insertInvoice(invoice: DepositInvoiceRecord, uow?: LedgerUnitOfWork): Promise<void>;
  updateInvoice(
    id: string,
    patch: { status: DepositStatus; depositTxnId?: string | null; paidAt?: string | null },
    uow?: LedgerUnitOfWork,
  ): Promise<void>;
  /** Every delivery is kept once per (gateway, eventId); handled before it is stored. */
  insertWebhookEvent(event: WebhookEventRecord, uow?: LedgerUnitOfWork): Promise<void>;

  /** With `lock`, holds the request row until `uow` commits, so reviews serialise. */
  getWithdrawal(
    id: string,
    uow?: LedgerUnitOfWork,
    opts?: { lock?: boolean },
  ): Promise<WithdrawalRecord | undefined>;
  /** Newest first. */
  withdrawalsOfUser(userId: string): Promise<WithdrawalRecord[]>;
  /** All requests in these statuses, oldest first, for the operator's queue. */
  withdrawalsByStatus(statuses: readonly WithdrawalStatus[]): Promise<WithdrawalRecord[]>;
  insertWithdrawal(record: WithdrawalRecord, uow?: LedgerUnitOfWork): Promise<void>;
  updateWithdrawal(
    id: string,
    patch: {
      status: WithdrawalStatus;
      releaseTxnId?: string | null;
      paidTxnId?: string | null;
      payoutReference?: string | null;
      reviewReason?: string | null;
      reviewedBy?: string | null;
      reviewedAt?: string | null;
    },
    uow?: LedgerUnitOfWork,
  ): Promise<void>;
  /** The sign-in phone behind a user id, shown next to the payout details in the queue. */
  phoneForUser(userId: string): Promise<string | null>;
}

export class IdentityInUseError extends Error {
  constructor() {
    super('This ID is already verified on another account.');
  }
}
