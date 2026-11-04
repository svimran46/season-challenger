import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
  type LedgerUnitOfWork,
} from '@season/wallet';
import { randomBytes } from 'node:crypto';
import {
  CLOCK,
  ECONOMY_REPOSITORY,
  FOOTBALL_FEED,
  LEDGER_STORE,
  type Clock,
} from '../common/tokens';
import type { ContestRecord, EconomyRepository, EntryRecord } from './stores';
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
  private readonly logger = new Logger(ContestsService.name);

  constructor(
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(ECONOMY_REPOSITORY) private readonly repo: EconomyRepository,
    @Inject(FOOTBALL_FEED) private readonly feed: FootballFeed,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async listForFixture(fixtureId: string) {
    const fixture = await this.feed.getFixture(fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${fixtureId} not found`);
    await this.refreshForRead();
    if (fixture.status === 'scheduled') await this.seedPublic(fixtureId);
    return (await this.repo.listContests({ fixtureId }))
      .filter((c) => !c.inviteOnly && c.status !== 'cancelled')
      .sort(
        (a, b) =>
          templateOrder(a) - templateOrder(b) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .map((c) => this.summary(c));
  }

  async get(contestId: string, viewerId?: string) {
    await this.refreshForRead();
    const contest = await this.find(contestId);
    const entries = await this.repo.entriesFor(contestId);
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
    const contest = await this.repo.contestByInviteCode(code.toUpperCase());
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
      inviteCode: await this.uniqueInviteCode(),
      createdBy: userId,
      templateKey: null,
      entryCount: 0,
      createdAt: this.clock().toISOString(),
      settledAt: null,
    };
    await this.repo.insertContest(record);
    return this.summary(record, userId);
  }

  /** Pays the entry fee in coins and enters the squad. One entry per player per tournament. */
  async join(userId: string, contestId: string, squad: Omit<SquadPick, 'fixtureId'>) {
    await this.wallet.ensurePlayer(userId);
    await this.refreshForRead();
    const found = await this.find(contestId);
    if (found.status !== 'open') {
      throw new ConflictException({ error: 'contest_closed', message: 'Entries are closed.' });
    }
    const fixture = await this.feed.getFixture(found.fixtureId);
    if (!fixture || fixture.status !== 'scheduled') {
      throw new ConflictException({
        error: 'contest_closed',
        message: 'This match has kicked off.',
      });
    }
    const pick: SquadPick = { ...squad, fixtureId: found.fixtureId };
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
      // Lock order everywhere: the contest row first, then ledger accounts.
      const contest = await this.repo.getContest(contestId, uow, { lock: true });
      if (!contest) throw new NotFoundException(`Tournament ${contestId} not found`);
      if (contest.status !== 'open') {
        throw new ConflictException({ error: 'contest_closed', message: 'Entries are closed.' });
      }
      if (await this.repo.getEntry(entryId, uow)) {
        throw new ConflictException({
          error: 'already_joined',
          message: 'You are already in this tournament.',
        });
      }
      const reader = await uow.lock(userAccounts(userId));
      const entries = contest.entryCount;
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
      await this.repo.insertEntry(entry, uow);
      contest.entryCount = entries + 1;
      if (contest.entryCount === contest.capacity && contest.templateKey) {
        await this.spawn(contest.fixtureId, contest.templateKey, uow);
      }
      return { entryId, contest: this.summary(contest, userId) };
    });
  }

  async myEntries(userId: string) {
    await this.wallet.ensurePlayer(userId);
    await this.refreshForRead();
    const mine = await this.repo.entriesOfUser(userId);
    const clubs = new Map((await this.feed.listClubs()).map((c) => [c.id, c]));
    const fixtures = new Map<string, Awaited<ReturnType<FootballFeed['getFixture']>>>();
    const contests = new Map<string, ContestRecord>();
    for (const e of mine) {
      if (!fixtures.has(e.squad.fixtureId)) {
        fixtures.set(e.squad.fixtureId, await this.feed.getFixture(e.squad.fixtureId));
      }
      if (!contests.has(e.contestId)) contests.set(e.contestId, await this.find(e.contestId));
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
        contest: this.summary(contests.get(e.contestId)!, userId),
      };
    });
  }

  /**
   * Moves tournaments along with their match: at kick-off one that has too few entries is
   * cancelled and refunded, otherwise it locks; once the match is final it is scored and paid.
   * Runs on reads and on the worker's timer. Each tournament is handled in its own transaction
   * under a row lock, so overlapping runs (or API instances) cannot process one twice.
   */
  /**
   * Reads bring tournaments up to date first, but a failure there (a lock timeout, a feed
   * outage) must not fail an unrelated read: the worker retries it on its next tick.
   */
  private async refreshForRead() {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`Tournament refresh failed on a read: ${String(error)}`);
    }
  }

  async refresh(): Promise<void> {
    const byFixture = new Map<string, ContestRecord[]>();
    for (const c of await this.repo.listContests({ statuses: ['open', 'locked'] })) {
      byFixture.set(c.fixtureId, [...(byFixture.get(c.fixtureId) ?? []), c]);
    }
    for (const [fixtureId, contests] of byFixture) {
      const fixture = await this.feed.getFixture(fixtureId);
      if (!fixture || fixture.status === 'scheduled') continue;
      for (const contest of contests) {
        if (contest.status === 'open') contest.status = await this.lockOrCancel(contest.id);
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
        if (contest.status === 'locked') await this.settle(contest.id, points, minutes);
      }
    }
  }

  /** Returns the tournament's status after the run. */
  private async lockOrCancel(contestId: string): Promise<ContestRecord['status']> {
    return this.ledger.transact(async (uow) => {
      const contest = await this.repo.getContest(contestId, uow, { lock: true });
      if (!contest) throw new Error(`Tournament ${contestId} vanished.`);
      if (contest.status !== 'open') return contest.status;
      const entries = await this.repo.entriesFor(contestId, uow);
      if (entries.length >= contest.minEntries) {
        await this.repo.updateContest(contestId, { status: 'locked' }, uow);
        return 'locked';
      }
      // Lock every account at once (sorted by the store) so a refund cannot deadlock with a
      // settlement taking the same players' accounts.
      const keys = entries.map((e) => `entry:${e.id}`);
      const reader = await uow.lock(
        [contestPool(contestId), ...entries.flatMap((e) => userAccounts(e.userId))],
        keys,
      );
      for (const key of keys) {
        const entryTxn = reader.findByKey(key);
        if (!entryTxn) throw new Error(`Missing ledger transaction ${key}.`);
        await uow.post(entryRefund(entryTxn));
      }
      await this.repo.updateContest(contestId, { status: 'cancelled' }, uow);
      return 'cancelled';
    });
  }

  private async settle(
    contestId: string,
    points: ReadonlyMap<string, number>,
    minutes: ReadonlyMap<string, number>,
  ) {
    await this.ledger.transact(async (uow) => {
      const contest = await this.repo.getContest(contestId, uow, { lock: true });
      if (!contest || contest.status !== 'locked') return;
      const entries = await this.repo.entriesFor(contestId, uow);
      const results = entries.map((e) => ({
        entryId: e.id,
        userId: e.userId,
        points: scoreSquad(e.squad, points, minutes),
      }));
      const reader = await uow.lock(
        [contestPool(contestId), ...entries.flatMap((e) => userAccounts(e.userId))],
        [`settle:${contestId}`],
      );
      const { draft, payouts } = contestSettlement(reader, contest, results);
      await uow.post(draft);
      for (const p of payouts) {
        await this.repo.recordResult(
          p.entryId,
          { points: p.points, rank: p.rank, prize: p.prize },
          uow,
        );
      }
      await this.repo.updateContest(
        contestId,
        { status: 'settled', settledAt: this.clock().toISOString() },
        uow,
      );
    });
  }

  private async seedPublic(fixtureId: string) {
    const open = await this.repo.listContests({ fixtureId, statuses: ['open'] });
    for (const t of PUBLIC_TEMPLATES) {
      if (!open.some((c) => c.templateKey === t.key)) await this.spawn(fixtureId, t.key);
    }
  }

  /**
   * Adds the next copy of a public tournament. Ids are deterministic and the insert skips an
   * existing id, so two requests seeding at once create one copy, not two.
   */
  private async spawn(fixtureId: string, templateKey: string, uow?: LedgerUnitOfWork) {
    const t = PUBLIC_TEMPLATES.find((p) => p.key === templateKey)!;
    const copies = (await this.repo.listContests({ fixtureId, templateKey: t.key }, uow)).length;
    const id = `${fixtureId}~${t.key}~${copies + 1}`;
    const setup = contestSetup({
      id,
      format: t.format,
      entryFee: t.entryFee,
      capacity: t.capacity,
    });
    await this.repo.insertContest(
      {
        ...setup,
        fixtureId,
        name: t.name,
        status: 'open',
        inviteCode: null,
        createdBy: null,
        templateKey: t.key,
        entryCount: 0,
        createdAt: this.clock().toISOString(),
        settledAt: null,
      },
      uow,
    );
  }

  private async find(contestId: string): Promise<ContestRecord> {
    const contest = await this.repo.getContest(contestId);
    if (!contest) throw new NotFoundException(`Tournament ${contestId} not found`);
    return contest;
  }

  /** The invite code is shown to the tournament's creator only. */
  private summary(c: ContestRecord, viewerId?: string) {
    const entries = c.entryCount;
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

  private async uniqueInviteCode(): Promise<string> {
    for (;;) {
      const code = this.code(6);
      if (!(await this.repo.inviteCodeTaken(code))) return code;
    }
  }
}
