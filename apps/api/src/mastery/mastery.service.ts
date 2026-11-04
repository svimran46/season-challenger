import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FootballFeed } from '@season/feed';
import {
  generateCard,
  gradeCard,
  gradingContext,
  isCardLocked,
  MIN_CARDS_FOR_LEADERBOARD,
  validateAnswers,
  type Answer,
  type Fixture,
} from '@season/shared';
import { masteryCardReward, type LedgerStore } from '@season/wallet';
import { CLOCK, FOOTBALL_FEED, LEDGER_STORE, type Clock } from '../common/tokens';
import { WalletService } from '../economy/wallet.service';
import type { MasteryStore, StoredCard } from './mastery.store';
import { callsOf, cardView, leaderboardView, myMasteryView } from './mastery.views';
import { shortPlayerLabel, type PlayerNames } from './player-names';

export const MASTERY_STORE = Symbol('MASTERY_STORE');
export const PLAYER_NAMES = Symbol('PLAYER_NAMES');
export const GRADE_ON_READ = Symbol('GRADE_ON_READ');

const LEADERBOARD_SIZE = 100;
/** Cards open a week before kick-off. */
const OPENS_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class MasteryService {
  private readonly logger = new Logger(MasteryService.name);

  constructor(
    @Inject(MASTERY_STORE) private readonly store: MasteryStore,
    @Inject(PLAYER_NAMES) private readonly names: PlayerNames,
    @Inject(GRADE_ON_READ) private readonly gradeOnRead: boolean,
    @Inject(FOOTBALL_FEED) private readonly feed: FootballFeed,
    @Inject(LEDGER_STORE) private readonly ledger: LedgerStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  /** The card for a match, created on first request. A match that has started never gets one. */
  async cardForFixture(fixtureId: string, viewerId?: string) {
    await this.gradeForRead();
    const fixture = await this.feed.getFixture(fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${fixtureId} not found`);
    const card = await this.ensureCard(fixture);
    if (!card) {
      throw new NotFoundException({
        error: 'no_card',
        message: 'This match had no analysis card.',
      });
    }
    return this.view(card, fixture, viewerId);
  }

  async submit(
    userId: string,
    cardId: string,
    answers: readonly { questionId: string; answer: Answer }[],
  ) {
    const card = await this.store.card(cardId);
    if (!card) throw new NotFoundException(`Card ${cardId} not found`);
    const fixture = await this.feed.getFixture(card.fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${card.fixtureId} not found`);
    if (card.gradedVersion !== null || isCardLocked(fixture, this.clock())) {
      throw new ConflictException({
        error: 'card_locked',
        message: 'This card locked at kick-off.',
      });
    }
    const check = validateAnswers(callsOf(card), answers);
    if (!check.valid) {
      throw new UnprocessableEntityException({
        error: 'invalid_answers',
        message: 'Some answers cannot be accepted.',
        issues: check.errors,
      });
    }
    await this.wallet.ensurePlayer(userId);
    await this.store.saveAnswers(userId, cardId, answers, this.clock().toISOString());
    // Keyed per card and player, so a retry after a failure here still pays exactly once.
    await this.ledger.transact((uow) => uow.post(masteryCardReward(userId, cardId)));
    return this.view(card, fixture, userId);
  }

  async mine(userId: string) {
    await this.gradeForRead();
    const season = await this.feed.getSeason();
    const [standing, history, clubs, fixtures] = await Promise.all([
      this.store.standing(userId, season.id),
      this.store.matchScores(userId, season.id),
      this.feed.listClubs(),
      this.feed.listFixtures(),
    ]);
    return myMasteryView({
      seasonId: season.id,
      rating: standing?.rating ?? 0,
      cardsCompleted: standing?.cardsCompleted ?? 0,
      tier: standing?.tier ?? (await this.store.startingTier(userId, season.id)),
      history,
      fixtures: new Map(fixtures.map((f) => [f.id, f])),
      clubs: new Map(clubs.map((c) => [c.id, c])),
    });
  }

  async leaderboard(viewerId?: string) {
    await this.gradeForRead();
    const season = await this.feed.getSeason();
    const rows = await this.store.leaderboard(
      season.id,
      MIN_CARDS_FOR_LEADERBOARD,
      LEADERBOARD_SIZE,
    );
    const names = await this.names(rows.map((r) => r.userId));
    return leaderboardView({
      seasonId: season.id,
      rows,
      nameOf: (id) => names.get(id) ?? shortPlayerLabel(id),
      viewerId,
    });
  }

  /**
   * Grades every card whose match has final stats. Safe to repeat and to run on two instances:
   * the store refuses a second grade. One bad card does not hold up the rest.
   */
  async gradeFinished(): Promise<void> {
    for (const card of await this.store.ungradedCards()) {
      try {
        await this.grade(card);
      } catch (error) {
        this.logger.error(`Could not grade card ${card.id}: ${String(error)}`);
      }
    }
  }

  private async grade(card: StoredCard) {
    const fixture = await this.feed.getFixture(card.fixtureId);
    if (!fixture || fixture.status !== 'finished') return;
    const stats = await this.feed.getStats(fixture.id);
    if (!stats?.isFinal) return;
    const players = await this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]);
    const grade = gradeCard(
      callsOf(card),
      await this.store.submissions(card.id),
      gradingContext(stats, players),
    );
    await this.store.recordGrade({
      cardId: card.id,
      fixture,
      grade,
      gradedAt: this.clock().toISOString(),
    });
  }

  private async gradeForRead() {
    if (this.gradeOnRead) await this.gradeFinished();
  }

  private async ensureCard(fixture: Fixture): Promise<StoredCard | undefined> {
    const existing = await this.store.cardForFixture(fixture.id);
    if (existing) {
      // A postponed match keeps its card open until the new kick-off.
      if (existing.locksAt !== fixture.kickoffAt && existing.gradedVersion === null) {
        await this.store.moveLock(existing.id, fixture.kickoffAt);
        return { ...existing, locksAt: fixture.kickoffAt };
      }
      return existing;
    }
    if (isCardLocked(fixture, this.clock())) return undefined;
    const [clubs, players] = await Promise.all([
      this.feed.listClubs(),
      this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]),
    ]);
    const home = clubs.find((c) => c.id === fixture.homeClubId);
    const away = clubs.find((c) => c.id === fixture.awayClubId);
    if (!home || !away) throw new Error(`Fixture ${fixture.id} has an unknown club.`);
    const calls = generateCard({ fixture, home, away, players });
    return this.store.createCard({
      fixtureId: fixture.id,
      opensAt: new Date(Date.parse(fixture.kickoffAt) - OPENS_BEFORE_MS).toISOString(),
      locksAt: fixture.kickoffAt,
      questions: calls.map((c) => c.question),
    });
  }

  private async view(card: StoredCard, fixture: Fixture, viewerId?: string) {
    const [clubs, players, answers, score] = await Promise.all([
      this.feed.listClubs(),
      this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]),
      viewerId ? this.store.answersOf(viewerId, card.id) : Promise.resolve([]),
      viewerId ? this.store.matchScore(viewerId, fixture.id) : Promise.resolve(undefined),
    ]);
    const home = clubs.find((c) => c.id === fixture.homeClubId)!;
    const away = clubs.find((c) => c.id === fixture.awayClubId)!;
    return cardView({
      card,
      fixture,
      home,
      away,
      names: { home, away, players },
      locked: isCardLocked(fixture, this.clock()),
      answers,
      score,
    });
  }
}
