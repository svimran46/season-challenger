import type { SquadPick } from '@season/shared';
import type { ContestSetup, IssuedVoucher, VoucherOffer } from '@season/wallet';

/*
 * In-memory records for players, tournaments and vouchers. They mirror the Postgres tables in
 * db/schema.ts and are replaced by repositories over them when accounts and the feed sync
 * land; the coin ledger itself already has a Postgres store (ledger/pg-ledger.store.ts).
 */

export interface PlayerProfile {
  id: string;
  createdAt: string;
  birthDate: string | null;
  idVerifiedAt: string | null;
  idDocumentHash: string | null;
  redemptionsBlocked: boolean;
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
  createdAt: string;
  settledAt: string | null;
}

export interface EntryRecord {
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
}

export class EconomyStores {
  readonly players = new Map<string, PlayerProfile>();
  readonly contests = new Map<string, ContestRecord>();
  readonly entries = new Map<string, EntryRecord>();
  readonly offers = new Map<string, VoucherOffer>();
  readonly vouchers = new Map<string, VoucherRecord>();

  entriesFor(contestId: string): EntryRecord[] {
    return [...this.entries.values()].filter((e) => e.contestId === contestId);
  }
}
