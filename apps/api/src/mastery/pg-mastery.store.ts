import {
  carryOverTier,
  QUESTION_TEMPLATES,
  questionToRow,
  seasonStanding,
  type Answer,
  type CallResolution,
  type CardSubmission,
  type SeasonStanding,
  type Tier,
} from '@season/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  analysisCard,
  cardAnswer,
  cardQuestion,
  fixture,
  masteryMatchScore,
  masterySeason,
  questionTemplate,
  season,
} from '../db/schema';
import type {
  AnswerInput,
  GradeInput,
  LeaderboardRow,
  MasteryStore,
  MatchScoreRecord,
  NewCard,
  StoredAnswer,
  StoredCard,
} from './mastery.store';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;
type CardRow = typeof analysisCard.$inferSelect;

/** Key for the advisory lock that lets one grader at a time write. */
const GRADE_LOCK = 7_301_002;

/** Season Mastery in Postgres. Every userId is app_user.id, the id the auth guard hands out. */
export class PgMasteryStore implements MasteryStore {
  constructor(private readonly db: Database) {}

  async cardForFixture(fixtureId: string): Promise<StoredCard | undefined> {
    const rows = await this.db
      .select()
      .from(analysisCard)
      .where(eq(analysisCard.fixtureId, fixtureId));
    return (await this.withQuestions(rows))[0];
  }

  async card(cardId: string): Promise<StoredCard | undefined> {
    const rows = await this.db.select().from(analysisCard).where(eq(analysisCard.id, cardId));
    return (await this.withQuestions(rows))[0];
  }

  async createCard(card: NewCard): Promise<StoredCard> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(questionTemplate)
        .values(
          QUESTION_TEMPLATES.map((t) => ({
            id: t.id,
            kind: t.kind,
            prompt: t.prompt,
            resolverKey: t.resolverKey,
          })),
        )
        .onConflictDoUpdate({
          target: questionTemplate.id,
          set: {
            kind: sql`excluded.kind`,
            prompt: sql`excluded.prompt`,
            resolverKey: sql`excluded.resolver_key`,
          },
        });
      const [row] = await tx
        .insert(analysisCard)
        .values({
          fixtureId: card.fixtureId,
          opensAt: new Date(card.opensAt),
          locksAt: new Date(card.locksAt),
        })
        .onConflictDoNothing({ target: analysisCard.fixtureId })
        .returning({ id: analysisCard.id });
      // The insert waits for a concurrent creator to commit, so its questions are there too.
      if (!row) return;
      await tx.insert(cardQuestion).values(
        card.questions.map((question, i) => {
          const { templateId, params } = questionToRow(question);
          return { cardId: row.id, templateId, position: i + 1, params };
        }),
      );
    });
    const stored = await this.cardForFixture(card.fixtureId);
    if (!stored) throw new Error(`The card for ${card.fixtureId} was not stored.`);
    return stored;
  }

  async moveLock(cardId: string, locksAt: string): Promise<void> {
    await this.db
      .update(analysisCard)
      .set({ locksAt: new Date(locksAt) })
      .where(eq(analysisCard.id, cardId));
  }

  async ungradedCards(): Promise<StoredCard[]> {
    const rows = await this.db
      .select({ card: analysisCard })
      .from(analysisCard)
      .innerJoin(fixture, eq(fixture.id, analysisCard.fixtureId))
      .where(and(isNull(analysisCard.gradedVersion), eq(fixture.status, 'finished')))
      .orderBy(asc(fixture.kickoffAt));
    return this.withQuestions(rows.map((r) => r.card));
  }

  async saveAnswers(
    userId: string,
    _cardId: string,
    answers: readonly AnswerInput[],
    answeredAt: string,
  ): Promise<void> {
    const at = new Date(answeredAt);
    await this.db
      .insert(cardAnswer)
      .values(
        answers.map((a) => ({
          userId,
          questionId: a.questionId,
          answer: a.answer,
          answeredAt: at,
        })),
      )
      .onConflictDoUpdate({
        target: [cardAnswer.userId, cardAnswer.questionId],
        set: { answer: sql`excluded.answer`, answeredAt: at },
      });
  }

  async answersOf(userId: string, cardId: string): Promise<StoredAnswer[]> {
    const rows = await this.db
      .select({
        questionId: cardAnswer.questionId,
        answer: cardAnswer.answer,
        answeredAt: cardAnswer.answeredAt,
        accuracy: cardAnswer.accuracy,
        weight: cardAnswer.weight,
      })
      .from(cardAnswer)
      .innerJoin(cardQuestion, eq(cardQuestion.id, cardAnswer.questionId))
      .where(and(eq(cardAnswer.userId, userId), eq(cardQuestion.cardId, cardId)))
      .orderBy(asc(cardQuestion.position));
    return rows.map((r) => ({
      questionId: r.questionId,
      answer: r.answer as Answer,
      answeredAt: r.answeredAt.toISOString(),
      accuracy: r.accuracy,
      weight: r.weight,
    }));
  }

  async submissions(cardId: string): Promise<CardSubmission[]> {
    const rows = await this.db
      .select({
        userId: cardAnswer.userId,
        questionId: cardAnswer.questionId,
        answer: cardAnswer.answer,
      })
      .from(cardAnswer)
      .innerJoin(cardQuestion, eq(cardQuestion.id, cardAnswer.questionId))
      .where(eq(cardQuestion.cardId, cardId));
    const byUser = new Map<string, Map<string, Answer>>();
    for (const r of rows) {
      const mine = byUser.get(r.userId) ?? new Map<string, Answer>();
      mine.set(r.questionId, r.answer as Answer);
      byUser.set(r.userId, mine);
    }
    return [...byUser].map(([userId, answers]) => ({ userId, answers }));
  }

  async recordGrade({ cardId, fixture: match, grade, gradedAt }: GradeInput): Promise<boolean> {
    const at = new Date(gradedAt);
    return this.db.transaction(async (tx) => {
      // Graders queue up here, so no rating is worked out from scores another grader has yet to
      // commit, and the loser of a race finds the card already graded.
      await tx.execute(sql`select pg_advisory_xact_lock(${GRADE_LOCK})`);
      const [card] = await tx
        .select({ gradedVersion: analysisCard.gradedVersion })
        .from(analysisCard)
        .where(eq(analysisCard.id, cardId));
      if (!card || card.gradedVersion !== null) return false;

      await tx
        .update(analysisCard)
        .set({ gradedVersion: grade.snapshotVersion, gradedAt: at })
        .where(eq(analysisCard.id, cardId));
      await tx.execute(sql`
        update card_question q set resolution = r.resolution
        from jsonb_to_recordset(${JSON.stringify(
          grade.resolutions.map((g) => ({ id: g.questionId, resolution: g.resolution })),
        )}::text::jsonb) as r(id uuid, resolution jsonb)
        where q.id = r.id`);

      if (grade.submissions.length === 0) return true;
      const graded = grade.submissions.map((s) => ({ ...s, id: s.userId }));

      await tx.execute(sql`
        update card_answer a
        set accuracy = g.accuracy, weight = g.weight, snapshot_version = ${grade.snapshotVersion}
        from jsonb_to_recordset(${JSON.stringify(
          graded.flatMap((s) =>
            s.calls.map((c) => ({
              user_id: s.id,
              question_id: c.questionId,
              accuracy: c.accuracy,
              weight: c.weight,
            })),
          ),
        )}::text::jsonb) as g(user_id text, question_id uuid, accuracy real, weight real)
        where a.user_id = g.user_id and a.question_id = g.question_id`);
      await tx.insert(masteryMatchScore).values(
        graded.map((s) => ({
          userId: s.id,
          fixtureId: match.id,
          score: s.score,
          snapshotVersion: grade.snapshotVersion,
          gradedAt: at,
        })),
      );

      const ids = graded.map((s) => s.id);
      const scores = await tx
        .select({ userId: masteryMatchScore.userId, score: masteryMatchScore.score })
        .from(masteryMatchScore)
        .innerJoin(fixture, eq(fixture.id, masteryMatchScore.fixtureId))
        .where(and(inArray(masteryMatchScore.userId, ids), eq(fixture.seasonId, match.seasonId)))
        .orderBy(asc(fixture.kickoffAt), asc(fixture.id));
      const held = await tx
        .select({ userId: masterySeason.userId, tier: masterySeason.tier })
        .from(masterySeason)
        .where(and(inArray(masterySeason.userId, ids), eq(masterySeason.seasonId, match.seasonId)));
      const tierHeld = new Map(held.map((r) => [r.userId, r.tier]));
      const carried = await carriedTiers(tx, ids, match.seasonId);

      await tx
        .insert(masterySeason)
        .values(
          ids.map((id) => ({
            userId: id,
            seasonId: match.seasonId,
            updatedAt: at,
            ...seasonStanding(
              scores.filter((s) => s.userId === id).map((s) => s.score),
              tierHeld.get(id) ?? carried.get(id) ?? 'Scout',
            ),
          })),
        )
        .onConflictDoUpdate({
          target: [masterySeason.userId, masterySeason.seasonId],
          set: {
            rating: sql`excluded.rating`,
            cardsCompleted: sql`excluded.cards_completed`,
            tier: sql`excluded.tier`,
            updatedAt: at,
          },
        });
      return true;
    });
  }

  async standing(userId: string, seasonId: string): Promise<SeasonStanding | undefined> {
    const [row] = await this.db
      .select({
        rating: masterySeason.rating,
        cardsCompleted: masterySeason.cardsCompleted,
        tier: masterySeason.tier,
      })
      .from(masterySeason)
      .where(and(eq(masterySeason.userId, userId), eq(masterySeason.seasonId, seasonId)));
    return row;
  }

  async startingTier(userId: string, seasonId: string): Promise<Tier> {
    return (await carriedTiers(this.db, [userId], seasonId)).get(userId) ?? 'Scout';
  }

  async matchScores(userId: string, seasonId: string): Promise<MatchScoreRecord[]> {
    const rows = await this.db
      .select({
        fixtureId: masteryMatchScore.fixtureId,
        score: masteryMatchScore.score,
        snapshotVersion: masteryMatchScore.snapshotVersion,
        gradedAt: masteryMatchScore.gradedAt,
      })
      .from(masteryMatchScore)
      .innerJoin(fixture, eq(fixture.id, masteryMatchScore.fixtureId))
      .where(and(eq(masteryMatchScore.userId, userId), eq(fixture.seasonId, seasonId)))
      .orderBy(desc(fixture.kickoffAt), desc(fixture.id));
    return rows.map((r) => ({ ...r, gradedAt: r.gradedAt.toISOString() }));
  }

  async matchScore(userId: string, fixtureId: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ score: masteryMatchScore.score })
      .from(masteryMatchScore)
      .where(and(eq(masteryMatchScore.userId, userId), eq(masteryMatchScore.fixtureId, fixtureId)));
    return row?.score;
  }

  async leaderboard(seasonId: string, minCards: number, limit: number): Promise<LeaderboardRow[]> {
    return this.db
      .select({
        userId: masterySeason.userId,
        rating: masterySeason.rating,
        cardsCompleted: masterySeason.cardsCompleted,
        tier: masterySeason.tier,
      })
      .from(masterySeason)
      .where(and(eq(masterySeason.seasonId, seasonId), gte(masterySeason.cardsCompleted, minCards)))
      .orderBy(
        desc(masterySeason.rating),
        desc(masterySeason.cardsCompleted),
        asc(masterySeason.userId),
      )
      .limit(limit);
  }

  private async withQuestions(rows: CardRow[]): Promise<StoredCard[]> {
    if (rows.length === 0) return [];
    const questions = await this.db
      .select({
        id: cardQuestion.id,
        cardId: cardQuestion.cardId,
        position: cardQuestion.position,
        templateId: cardQuestion.templateId,
        resolverKey: questionTemplate.resolverKey,
        params: cardQuestion.params,
        resolution: cardQuestion.resolution,
      })
      .from(cardQuestion)
      .innerJoin(questionTemplate, eq(questionTemplate.id, cardQuestion.templateId))
      .where(
        inArray(
          cardQuestion.cardId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(cardQuestion.position));
    return rows.map((r) => ({
      id: r.id,
      fixtureId: r.fixtureId,
      opensAt: r.opensAt.toISOString(),
      locksAt: r.locksAt.toISOString(),
      gradedVersion: r.gradedVersion,
      gradedAt: r.gradedAt?.toISOString() ?? null,
      questions: questions
        .filter((q) => q.cardId === r.id)
        .map(({ cardId: _, resolution, ...q }) => ({
          ...q,
          resolution: resolution as CallResolution | null,
        })),
    }));
  }
}

/** What each player carries into a season from the most recent season before it. */
async function carriedTiers(
  db: Executor,
  userIds: string[],
  seasonId: string,
): Promise<Map<string, Tier>> {
  const earlier = await db
    .select({ userId: masterySeason.userId, tier: masterySeason.tier })
    .from(masterySeason)
    .innerJoin(season, eq(season.id, masterySeason.seasonId))
    .where(
      and(
        inArray(masterySeason.userId, userIds),
        ne(masterySeason.seasonId, seasonId),
        lt(season.startsOn, sql`(select starts_on from season where id = ${seasonId})`),
      ),
    )
    .orderBy(asc(season.startsOn));
  // Oldest first, so a later season overwrites an earlier one.
  return new Map(earlier.map((r) => [r.userId, carryOverTier(r.tier)]));
}
