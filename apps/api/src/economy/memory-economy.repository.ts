import type { VoucherOffer } from '@season/wallet';
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

const copy = <T>(value: T): T => structuredClone(value);

/**
 * Players, tournaments and vouchers in memory, for development and tests. It runs inside
 * MemoryLedgerStore's one-at-a-time units of work, so it needs no locks of its own.
 */
export class MemoryEconomyRepository implements EconomyRepository {
  private readonly players = new Map<string, PlayerProfile>();
  private readonly contests = new Map<string, ContestRecord>();
  private readonly entries = new Map<string, EntryRecord>();
  private readonly offers = new Map<string, VoucherOffer>();
  private readonly vouchers = new Map<string, VoucherRecord>();

  // ------------------------------------------------------------ players

  async getPlayer(id: string) {
    const p = this.players.get(id);
    return p && copy(p);
  }

  async createPlayer(profile: PlayerProfile) {
    if (!this.players.has(profile.id)) this.players.set(profile.id, copy(profile));
    return copy(this.players.get(profile.id)!);
  }

  async findPlayerByDocumentHash(hash: string) {
    const p = [...this.players.values()].find((x) => x.idDocumentHash === hash);
    return p && copy(p);
  }

  async recordVerification(
    id: string,
    v: { birthDate: string; idDocumentHash: string; idVerifiedAt: string },
  ) {
    for (const other of this.players.values()) {
      if (other.id !== id && other.idDocumentHash === v.idDocumentHash) {
        throw new IdentityInUseError();
      }
    }
    const p = this.players.get(id);
    if (!p) throw new Error(`Player ${id} not found`);
    Object.assign(p, v);
  }

  async recordCheckIn(userId: string, checkIn: { date: string; streak: number }) {
    const p = this.players.get(userId);
    if (!p) throw new Error(`Player ${userId} not found`);
    p.lastCheckIn = { date: checkIn.date, streak: checkIn.streak };
  }

  // ------------------------------------------------------------ tournaments

  async listContests(filter: ContestFilter) {
    return [...this.contests.values()]
      .filter(
        (c) =>
          (!filter.fixtureId || c.fixtureId === filter.fixtureId) &&
          (!filter.statuses || filter.statuses.includes(c.status)) &&
          (!filter.templateKey || c.templateKey === filter.templateKey),
      )
      .map(copy);
  }

  async getContest(id: string) {
    const c = this.contests.get(id);
    return c && copy(c);
  }

  async contestByInviteCode(code: string) {
    const c = [...this.contests.values()].find((x) => x.inviteCode === code);
    return c && copy(c);
  }

  async insertContest(record: ContestRecord) {
    if (this.contests.has(record.id)) return false;
    this.contests.set(record.id, copy(record));
    return true;
  }

  async updateContest(id: string, patch: { status: ContestStatus; settledAt?: string | null }) {
    const c = this.contests.get(id);
    if (!c) throw new Error(`Tournament ${id} not found`);
    c.status = patch.status;
    if (patch.settledAt !== undefined) c.settledAt = patch.settledAt;
  }

  async inviteCodeTaken(code: string) {
    return [...this.contests.values()].some((c) => c.inviteCode === code);
  }

  // ------------------------------------------------------------ entries

  async getEntry(id: string) {
    const e = this.entries.get(id);
    return e && copy(e);
  }

  async entriesFor(contestId: string) {
    return [...this.entries.values()].filter((e) => e.contestId === contestId).map(copy);
  }

  async entriesOfUser(userId: string) {
    return [...this.entries.values()]
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
      .map(copy);
  }

  async insertEntry(entry: EntryRecord) {
    const c = this.contests.get(entry.contestId);
    if (!c) throw new Error(`Tournament ${entry.contestId} not found`);
    if (this.entries.has(entry.id)) throw new Error(`Entry ${entry.id} exists`);
    this.entries.set(entry.id, copy(entry));
    c.entryCount += 1;
  }

  async recordResult(entryId: string, result: { points: number; rank: number; prize: number }) {
    const e = this.entries.get(entryId);
    if (!e) throw new Error(`Entry ${entryId} not found`);
    Object.assign(e, result);
  }

  // ------------------------------------------------------------ vouchers

  async upsertOffers(offers: readonly VoucherOffer[]) {
    for (const o of offers) {
      const existing = this.offers.get(o.id);
      this.offers.set(o.id, { ...copy(o), stock: existing ? existing.stock : o.stock });
    }
  }

  async listOffers() {
    return [...this.offers.values()].map(copy);
  }

  async getOffer(id: string) {
    const o = this.offers.get(id);
    return o && copy(o);
  }

  async decrementStock(offerId: string) {
    const o = this.offers.get(offerId);
    if (o && o.stock !== null) o.stock -= 1;
  }

  async getVoucher(id: string) {
    const v = this.vouchers.get(id);
    return v && copy(v);
  }

  async voucherCodeTaken(code: string) {
    return [...this.vouchers.values()].some((v) => v.code === code);
  }

  async insertVoucher(record: VoucherRecord) {
    this.vouchers.set(record.id, copy(record));
  }

  async vouchersOfUser(userId: string, opts: { since?: string } = {}) {
    const since = opts.since ? Date.parse(opts.since) : -Infinity;
    return [...this.vouchers.values()]
      .filter((v) => v.userId === userId && Date.parse(v.issuedAt) >= since)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map(copy);
  }
}
