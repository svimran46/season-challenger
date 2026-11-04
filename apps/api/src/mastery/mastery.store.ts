import {
  carryOverTier,
  questionToRow,
  seasonStanding,
  type Answer,
  type CallResolution,
  type CardGrade,
  type CardSubmission,
  type Fixture,
  type Question,
  type SeasonStanding,
  type Tier,
} from '@season/shared';
import { randomUUID } from 'node:crypto';

export interface StoredQuestion {
  id: string;
  position: number;
  templateId: string;
  resolverKey: string;
  params: unknown;
  resolution: CallResolution | null;
}

export interface StoredCard {
  id: string;
  fixtureId: string;
  opensAt: string;
  locksAt: string;
  /** The stats snapshot this card was graded from; null until then. */
  gradedVersion: number | null;
  gradedAt: string | null;
  questions: StoredQuestion[];
}

export interface NewCard {
  fixtureId: string;
  opensAt: string;
  locksAt: string;
  questions: readonly Question[];
}

export interface AnswerInput {
  questionId: string;
  answer: Answer;
}

export interface StoredAnswer extends AnswerInput {
  answeredAt: string;
  accuracy: number | null;
  weight: number | null;
}

export interface GradeInput {
  cardId: string;
  fixture: Pick<Fixture, 'id' | 'seasonId' | 'kickoffAt'>;
  grade: CardGrade;
  gradedAt: string;
}

export interface MatchScoreRecord {
  fixtureId: string;
  score: number;
  snapshotVersion: number;
  gradedAt: string;
}

export interface LeaderboardRow extends SeasonStanding {
  userId: string;
}

/**
 * Season Mastery data. Every userId is the id the auth guard hands out, which also names the
 * player's coin accounts. Rules stay in @season/shared; a store only keeps grading atomic.
 */
export interface MasteryStore {
  cardForFixture(fixtureId: string): Promise<StoredCard | undefined>;
  card(cardId: string): Promise<StoredCard | undefined>;
  /** Stores a fixture's card, or returns the one a concurrent request stored first. */
  createCard(card: NewCard): Promise<StoredCard>;
  /** Keeps a card's lock on its fixture when the feed moves the kick-off. */
  moveLock(cardId: string, locksAt: string): Promise<void>;
  /** Cards still to grade whose match may be over. The service checks each with the feed. */
  ungradedCards(): Promise<StoredCard[]>;
  /** Saves one player's whole submission as one write, replacing any earlier answers. */
  saveAnswers(
    userId: string,
    cardId: string,
    answers: readonly AnswerInput[],
    answeredAt: string,
  ): Promise<void>;
  answersOf(userId: string, cardId: string): Promise<StoredAnswer[]>;
  submissions(cardId: string): Promise<CardSubmission[]>;
  /**
   * Writes a grade and rolls it into season ratings, all or nothing. Returns false and changes
   * nothing if the card already has a grade, so a repeat or a second grader cannot double count.
   */
  recordGrade(input: GradeInput): Promise<boolean>;
  standing(userId: string, seasonId: string): Promise<SeasonStanding | undefined>;
  /** The tier a player opens a season on: one below where their last season ended. */
  startingTier(userId: string, seasonId: string): Promise<Tier>;
  /** Newest match first. */
  matchScores(userId: string, seasonId: string): Promise<MatchScoreRecord[]>;
  matchScore(userId: string, fixtureId: string): Promise<number | undefined>;
  /** Players with at least minCards graded cards, best first. */
  leaderboard(seasonId: string, minCards: number, limit: number): Promise<LeaderboardRow[]>;
}

interface MemoryScore extends MatchScoreRecord {
  seasonId: string;
  kickoffAt: string;
}

/** The store for tests and local development without a database. Lost on restart. */
export class MemoryMasteryStore implements MasteryStore {
  private readonly cards = new Map<string, StoredCard>();
  private readonly cardIdOfFixture = new Map<string, string>();
  /** By card, then player, then question. */
  private readonly answers = new Map<string, Map<string, Map<string, StoredAnswer>>>();
  private readonly scores = new Map<string, MemoryScore[]>();
  /** By player, then season, oldest season first. */
  private readonly seasons = new Map<string, Map<string, SeasonStanding>>();

  async cardForFixture(fixtureId: string): Promise<StoredCard | undefined> {
    const id = this.cardIdOfFixture.get(fixtureId);
    return id === undefined ? undefined : this.cards.get(id);
  }

  async card(cardId: string): Promise<StoredCard | undefined> {
    return this.cards.get(cardId);
  }

  async createCard(card: NewCard): Promise<StoredCard> {
    const existing = await this.cardForFixture(card.fixtureId);
    if (existing) return existing;
    const stored: StoredCard = {
      id: randomUUID(),
      fixtureId: card.fixtureId,
      opensAt: card.opensAt,
      locksAt: card.locksAt,
      gradedVersion: null,
      gradedAt: null,
      questions: card.questions.map((question, i) => {
        const { templateId, resolverKey, params } = questionToRow(question);
        return {
          id: randomUUID(),
          position: i + 1,
          templateId,
          resolverKey,
          params,
          resolution: null,
        };
      }),
    };
    this.cards.set(stored.id, stored);
    this.cardIdOfFixture.set(card.fixtureId, stored.id);
    return stored;
  }

  async moveLock(cardId: string, locksAt: string): Promise<void> {
    const card = this.cards.get(cardId);
    if (card) card.locksAt = locksAt;
  }

  async ungradedCards(): Promise<StoredCard[]> {
    return [...this.cards.values()].filter((c) => c.gradedVersion === null);
  }

  async saveAnswers(
    userId: string,
    cardId: string,
    answers: readonly AnswerInput[],
    answeredAt: string,
  ): Promise<void> {
    const byUser = this.answers.get(cardId) ?? new Map<string, Map<string, StoredAnswer>>();
    byUser.set(
      userId,
      new Map(
        answers.map((a) => [
          a.questionId,
          { ...a, answeredAt, accuracy: null, weight: null } satisfies StoredAnswer,
        ]),
      ),
    );
    this.answers.set(cardId, byUser);
  }

  async answersOf(userId: string, cardId: string): Promise<StoredAnswer[]> {
    return [...(this.answers.get(cardId)?.get(userId)?.values() ?? [])];
  }

  async submissions(cardId: string): Promise<CardSubmission[]> {
    return [...(this.answers.get(cardId) ?? new Map<string, Map<string, StoredAnswer>>())].map(
      ([userId, mine]) => ({
        userId,
        answers: new Map([...mine].map(([questionId, a]) => [questionId, a.answer])),
      }),
    );
  }

  async recordGrade({ cardId, fixture, grade, gradedAt }: GradeInput): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (!card || card.gradedVersion !== null) return false;

    card.gradedVersion = grade.snapshotVersion;
    card.gradedAt = gradedAt;
    for (const { questionId, resolution } of grade.resolutions) {
      const question = card.questions.find((q) => q.id === questionId);
      if (question) question.resolution = resolution;
    }
    for (const submission of grade.submissions) {
      const mine = this.answers.get(cardId)?.get(submission.userId);
      for (const call of submission.calls) {
        const answer = mine?.get(call.questionId);
        if (answer) Object.assign(answer, { accuracy: call.accuracy, weight: call.weight });
      }
      const scores = this.scores.get(submission.userId) ?? [];
      scores.push({
        fixtureId: fixture.id,
        seasonId: fixture.seasonId,
        kickoffAt: fixture.kickoffAt,
        score: submission.score,
        snapshotVersion: grade.snapshotVersion,
        gradedAt,
      });
      this.scores.set(submission.userId, scores);

      const inSeason = scores
        .filter((s) => s.seasonId === fixture.seasonId)
        .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
      const current =
        this.seasons.get(submission.userId)?.get(fixture.seasonId)?.tier ??
        this.carriedTier(submission.userId, fixture.seasonId);
      const seasons = this.seasons.get(submission.userId) ?? new Map<string, SeasonStanding>();
      seasons.set(
        fixture.seasonId,
        seasonStanding(
          inSeason.map((s) => s.score),
          current,
        ),
      );
      this.seasons.set(submission.userId, seasons);
    }
    return true;
  }

  async standing(userId: string, seasonId: string): Promise<SeasonStanding | undefined> {
    return this.seasons.get(userId)?.get(seasonId);
  }

  async startingTier(userId: string, seasonId: string): Promise<Tier> {
    return this.carriedTier(userId, seasonId);
  }

  private carriedTier(userId: string, seasonId: string): Tier {
    const earlier = [...(this.seasons.get(userId) ?? new Map<string, SeasonStanding>())].filter(
      ([id]) => id !== seasonId,
    );
    const last = earlier.at(-1)?.[1];
    return last ? carryOverTier(last.tier) : 'Scout';
  }

  async matchScores(userId: string, seasonId: string): Promise<MatchScoreRecord[]> {
    return (this.scores.get(userId) ?? [])
      .filter((s) => s.seasonId === seasonId)
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
      .map(({ fixtureId, score, snapshotVersion, gradedAt }) => ({
        fixtureId,
        score,
        snapshotVersion,
        gradedAt,
      }));
  }

  async matchScore(userId: string, fixtureId: string): Promise<number | undefined> {
    return this.scores.get(userId)?.find((s) => s.fixtureId === fixtureId)?.score;
  }

  async leaderboard(seasonId: string, minCards: number, limit: number): Promise<LeaderboardRow[]> {
    const rows: LeaderboardRow[] = [];
    for (const [userId, seasons] of this.seasons) {
      const standing = seasons.get(seasonId);
      if (standing && standing.cardsCompleted >= minCards) rows.push({ userId, ...standing });
    }
    return rows
      .sort(
        (a, b) =>
          b.rating - a.rating ||
          b.cardsCompleted - a.cardsCompleted ||
          a.userId.localeCompare(b.userId),
      )
      .slice(0, limit);
  }
}
