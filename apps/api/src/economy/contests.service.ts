import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FootballFeed } from '@season/feed';
import { scorePlayer, scoreSquad, validateSquad, type SquadPick } from '@season/shared';
import {
  contestEntry,
  contestPool,
  contestSettlement,
  contestSetup,
  entryRefund,
  FORMAT_RULES,
  type ContestFormat,
  type LedgerStore,
} from '@season/wallet';
import { randomBytes } from 'node:crypto';
import { CLOCK, ECONOMY_STORES, FOOTBALL_FEED, LEDGER_STORE, type Clock } from '../common/tokens';
import type { ContestRecord, EconomyStores, EntryRecord } from './stores';
import { userAccounts, WalletService } from './wallet.service';

/** The public tournaments every upcoming match gets. A full one is replaced by a fresh copy. */
export const PUBLIC_TEMPLATES: {
  key: string;
  name: string;
  format: ContestFormat;
  entryFee: number;
  capacity?: number;
}[] = [
  { key: 'h2h-25', name: 'Head-to-head', format: 'head_to_head', entryFee: 25 },
  { key: 'h2h-100', name: 'Head-to-head high stakes', format: 'head_to_head', entryFee: 100 },
  { key: 'league-50', name: 'Small league', format: 'small_league', entryFee: 50, capacity: 10 },
  { key: 'mega-20', name: 'Mega tournament', format: 'mega', entryFee: 20, capacity: 500 },
];

const templateOrder = (c: ContestRecord) => {
  const i = PUBLIC_TEMPLATES.findIndex((t) => t.key === c.templateKey);
  return i === -1 ? PUBLIC_TEMPLATES.length : i;
};

const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

@Injectable()
export class ContestsService {
  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_STORES) private readonly stores: EconomyStores,
    @Inject(FOOTBALL_FEED) private readonly feed: FootballFeed,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async listForFixture(fixtureId: string) {
    const fixture = await this.feed.getFixture(fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${fixtureId} not found`);
    await this.refresh();
    if (fixture.status === 'scheduled') this.seedPublic(fixtureId);
    return [...this.stores.contests.values()]
      .filter((c) => c.fixtureId === fixtureId && !c.inviteOnly)
      .filter((c) => c.status !== 'cancelled')
      .sort((a, b) => templateOrder(a) - templateOrder(b))
      .map((c) => this.summary(c));
  }

  async get(contestId: string, viewerId?: string) {
    await this.refresh();
    const contest = this.find(contestId);
    const entries = this.stores.entriesFor(contestId);
    const leaderboard =
      contest.status === 'open'
        ? []
        : entries
            .slice()
            .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id))
            .map((e) => ({ userId: e.userId, points: e.points, rank: e.rank, prize: e.prize }));
    return {
      ...this.summary(contest, viewerId),
      joined: viewerId ? entries.some((e) => e.userId === viewerId) : false,
      leaderboard,
    };
  }

  async byInviteCode(code: string) {
    const contest = [...this.stores.contests.values()].find(
      (c) => c.inviteCode === code.toUpperCase(),
    );
    if (!contest) throw new NotFoundException('No tournament has that invite code.');
    return this.get(contest.id);
  }

  async createPrivate(
    userId: string,
    input: { fixtureId: string; name: string; entryFee: number; capacity: number },
  ) {
    await this.wallet.ensurePlayer(userId);
    const fixture = await this.feed.getFixture(input.fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${input.fixtureId} not found`);
    if (fixture.status !== 'scheduled') {
      throw new ConflictException('This match has kicked off.');
    }
    const id = `${input.fixtureId}~private~${this.code(10)}`;
    const setup = contestSetup({
      id,
      format: 'private',
      entryFee: input.entryFee,
      capacity: input.capacity,
    });
    const record: ContestRecord = {
      ...setup,
      fixtureId: input.fixtureId,
      name: input.name,
      status: 'open',
      inviteCode: this.uniqueInviteCode(),
      createdBy: userId,
      templateKey: null,
      createdAt: this.clock().toISOString(),
      settledAt: null,
    };
    this.stores.contests.set(id, record);
    return this.summary(record, userId);
  }

  /** Pays the entry fee in coins and enters the squad. One entry per player per tournament. */
  async join(userId: string, contestId: string, squad: Omit<SquadPick, 'fixtureId'>) {
    await this.wallet.ensurePlayer(userId);
    await this.refresh();
    const contest = this.find(contestId);
    if (contest.status !== 'open') {
      throw new ConflictException({ error: 'contest_closed', message: 'Entries are closed.' });
    }
    const fixture = await this.feed.getFixture(contest.fixtureId);
    if (!fixture || fixture.status !== 'scheduled') {
      throw new ConflictException({
        error: 'contest_closed',
        message: 'This match has kicked off.',
      });
    }
    const pick: SquadPick = { ...squad, fixtureId: contest.fixtureId };
    const players = await this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]);
    const check = validateSquad(pick, players);
    if (!check.valid) {
      throw new UnprocessableEntityException({
        error: 'invalid_squad',
        message: 'This squad breaks the squad rules.',
        issues: check.errors,
      });
    }

    const entryId = `${contestId}:${userId}`;
    return this.ledger.transact(async (uow) => {
      const existing = this.stores.entries.get(entryId);
      if (existing) {
        throw new ConflictException({
          error: 'already_joined',
          message: 'You are already in this tournament.',
        });
      }
      const reader = await uow.lock(userAccounts(userId));
      const entries = this.stores.entriesFor(contestId).length;
      const txn = await uow.post(
        contestEntry(reader, contest, { entryId, userId, currentEntries: entries }),
      );
      const entry: EntryRecord = {
        id: entryId,
        contestId,
        userId,
        squad: pick,
        entryTxnId: txn.id,
        points: null,
        rank: null,
        prize: null,
        joinedAt: this.clock().toISOString(),
      };
      this.stores.entries.set(entryId, entry);
      if (entries + 1 === contest.capacity && contest.templateKey) {
        this.spawn(contest.fixtureId, contest.templateKey);
      }
      return { entryId, contest: this.summary(contest, userId) };
    });
  }

  async myEntries(userId: string) {
    await this.wallet.ensurePlayer(userId);
    await this.refresh();
    const mine = [...this.stores.entries.values()]
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
    const clubs = new Map((await this.feed.listClubs()).map((c) => [c.id, c]));
    const fixtures = new Map<string, Awaited<ReturnType<FootballFeed['getFixture']>>>();
    for (const e of mine) {
      if (!fixtures.has(e.squad.fixtureId)) {
        fixtures.set(e.squad.fixtureId, await this.feed.getFixture(e.squad.fixtureId));
      }
    }
    return mine.map((e) => {
      const f = fixtures.get(e.squad.fixtureId);
      return {
        entryId: e.id,
        points: e.points,
        rank: e.rank,
        prize: e.prize,
        joinedAt: e.joinedAt,
        fixture: f && {
          id: f.id,
          kickoffAt: f.kickoffAt,
          status: f.status,
          home: clubs.get(f.homeClubId)?.shortName ?? f.homeClubId,
          away: clubs.get(f.awayClubId)?.shortName ?? f.awayClubId,
        },
        contest: this.summary(this.find(e.contestId), userId),
      };
    });
  }

  /**
   * Moves tournaments along with their match: at kick-off one that has too few entries is
   * cancelled and refunded, otherwise it locks; once the match is final it is scored and paid.
   * Called on reads here; a scheduled worker runs it in production.
   */
  async refresh(): Promise<void> {
    const byFixture = new Map<string, ContestRecord[]>();
    for (const c of this.stores.contests.values()) {
      if (c.status === 'open' || c.status === 'locked') {
        byFixture.set(c.fixtureId, [...(byFixture.get(c.fixtureId) ?? []), c]);
      }
    }
    for (const [fixtureId, contests] of byFixture) {
      const fixture = await this.feed.getFixture(fixtureId);
      if (!fixture || fixture.status === 'scheduled') continue;
      for (const contest of contests) {
        if (contest.status === 'open') await this.lockOrCancel(contest);
      }
      if (fixture.status !== 'finished') continue;
      const stats = await this.feed.getStats(fixtureId);
      if (!stats?.isFinal) continue;
      const players = await this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]);
      const position = new Map(players.map((p) => [p.id, p.position]));
      const points = new Map<string, number>();
      const minutes = new Map<string, number>();
      for (const s of stats.players) {
        const pos = position.get(s.playerId);
        if (!pos) continue;
        points.set(s.playerId, scorePlayer(pos, s).points);
        minutes.set(s.playerId, s.minutes);
      }
      for (const contest of contests) {
        if (contest.status === 'locked') await this.settle(contest, points, minutes);
      }
    }
  }

  private async lockOrCancel(contest: ContestRecord) {
    const entries = this.stores.entriesFor(contest.id);
    if (entries.length >= contest.minEntries) {
      contest.status = 'locked';
      return;
    }
    await this.ledger.transact(async (uow) => {
      for (const e of entries) {
        const entryTxn = await this.ledgerTxn(`entry:${e.id}`);
        await uow.lock([...userAccounts(e.userId), contestPool(contest.id)]);
        await uow.post(entryRefund(entryTxn));
      }
      contest.status = 'cancelled';
    });
  }

  private async settle(
    contest: ContestRecord,
    points: ReadonlyMap<string, number>,
    minutes: ReadonlyMap<string, number>,
  ) {
    const entries = this.stores.entriesFor(contest.id);
    const results = entries.map((e) => ({
      entryId: e.id,
      userId: e.userId,
      points: scoreSquad(e.squad, points, minutes),
    }));
    await this.ledger.transact(async (uow) => {
      const reader = await uow.lock(
        [contestPool(contest.id), ...entries.flatMap((e) => userAccounts(e.userId))],
        [`settle:${contest.id}`],
      );
      const { draft, payouts } = contestSettlement(reader, contest, results);
      await uow.post(draft);
      for (const p of payouts) {
        const entry = this.stores.entries.get(p.entryId)!;
        entry.points = p.points;
        entry.rank = p.rank;
        entry.prize = p.prize;
      }
      contest.status = 'settled';
      contest.settledAt = this.clock().toISOString();
    });
  }

  private async ledgerTxn(key: string) {
    const txn = await this.ledger.findByKey(key);
    if (!txn) throw new Error(`Missing ledger transaction ${key}.`);
    return txn;
  }

  private seedPublic(fixtureId: string) {
    for (const t of PUBLIC_TEMPLATES) {
      const open = [...this.stores.contests.values()].some(
        (c) => c.fixtureId === fixtureId && c.templateKey === t.key && c.status === 'open',
      );
      if (!open) this.spawn(fixtureId, t.key);
    }
  }

  private spawn(fixtureId: string, templateKey: string) {
    const t = PUBLIC_TEMPLATES.find((p) => p.key === templateKey)!;
    const copies = [...this.stores.contests.values()].filter(
      (c) => c.fixtureId === fixtureId && c.templateKey === t.key,
    ).length;
    const id = `${fixtureId}~${t.key}~${copies + 1}`;
    const setup = contestSetup({
      id,
      format: t.format,
      entryFee: t.entryFee,
      capacity: t.capacity,
    });
    this.stores.contests.set(id, {
      ...setup,
      fixtureId,
      name: t.name,
      status: 'open',
      inviteCode: null,
      createdBy: null,
      templateKey: t.key,
      createdAt: this.clock().toISOString(),
      settledAt: null,
    });
  }

  private find(contestId: string): ContestRecord {
    const contest = this.stores.contests.get(contestId);
    if (!contest) throw new NotFoundException(`Tournament ${contestId} not found`);
    return contest;
  }

  /** The invite code is shown to the tournament's creator only. */
  private summary(c: ContestRecord, viewerId?: string) {
    const entries = this.stores.entriesFor(c.id).length;
    const rules = FORMAT_RULES[c.format];
    return {
      id: c.id,
      fixtureId: c.fixtureId,
      name: c.name,
      format: c.format,
      formatLabel: rules.label,
      status: c.status,
      entryFee: c.entryFee,
      capacity: c.capacity,
      entries,
      spotsLeft: c.capacity - entries,
      minEntries: c.minEntries,
      guaranteed: c.guaranteed,
      prizeTable: c.prizeTable,
      topPrize: c.prizeTable[0]?.amount ?? 0,
      inviteCode: viewerId && c.createdBy === viewerId ? c.inviteCode : null,
    };
  }

  private code(length: number) {
    const bytes = randomBytes(length * 2);
    let out = '';
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
    }
    return out;
  }

  private uniqueInviteCode(): string {
    const taken = new Set([...this.stores.contests.values()].map((c) => c.inviteCode));
    for (;;) {
      const code = this.code(6);
      if (!taken.has(code)) return code;
    }
  }
}
