import {
  describeResolution,
  isLeaderboardEligible,
  MIN_CARDS_FOR_LEADERBOARD,
  nextTierProgress,
  questionFromRow,
  rankEntries,
  renderCall,
  type CallNames,
  type CardCall,
  type Club,
  type Fixture,
  type Tier,
} from '@season/shared';
import { DEFAULT_REWARDS } from '@season/wallet';
import type { LeaderboardRow, MatchScoreRecord, StoredAnswer, StoredCard } from './mastery.store';

export const callsOf = (card: StoredCard): CardCall[] =>
  card.questions.map((q) => ({ id: q.id, question: questionFromRow(q.resolverKey, q.params) }));

export type CardStatus = 'open' | 'locked' | 'graded';

const clubView = (c: Club) => ({
  id: c.id,
  name: c.name,
  shortName: c.shortName,
  colour: c.colour,
});

/**
 * The card as a player sees it. The only answers in it are the viewer's own. What happened, how
 * accurate a call was and how the crowd weighed it stay out until the card is graded.
 */
export function cardView(input: {
  card: StoredCard;
  fixture: Fixture;
  home: Club;
  away: Club;
  names: CallNames;
  locked: boolean;
  /** The viewer's answers; empty when signed out. */
  answers: readonly StoredAnswer[];
  /** The viewer's match score. */
  score: number | undefined;
}) {
  const { card, fixture, home, away, names, locked, answers, score } = input;
  const graded = card.gradedVersion !== null;
  const status: CardStatus = graded ? 'graded' : locked ? 'locked' : 'open';
  const answerOf = new Map(answers.map((a) => [a.questionId, a]));
  const lastAnswer = answers
    .map((a) => a.answeredAt)
    .sort()
    .at(-1);
  return {
    id: card.id,
    fixtureId: card.fixtureId,
    status,
    opensAt: card.opensAt,
    locksAt: fixture.kickoffAt,
    gradedVersion: card.gradedVersion,
    gradedAt: card.gradedAt,
    fixture: {
      gameweek: fixture.gameweek,
      kickoffAt: fixture.kickoffAt,
      status: fixture.status,
      home: clubView(home),
      away: clubView(away),
    },
    rewardCoins: DEFAULT_REWARDS.masteryCard,
    submittedAt: lastAnswer ?? null,
    score: graded ? (score ?? null) : null,
    calls: card.questions.map((q) => {
      const question = questionFromRow(q.resolverKey, q.params);
      const mine = answerOf.get(q.id);
      return {
        id: q.id,
        position: q.position,
        kind: question.kind,
        ...renderCall(question, names),
        answer: mine?.answer ?? null,
        result:
          graded && q.resolution
            ? {
                ...describeResolution(question, q.resolution, names),
                accuracy: mine?.accuracy ?? null,
                weight: mine?.weight ?? null,
              }
            : null,
      };
    }),
  };
}

export type CardView = ReturnType<typeof cardView>;

export function myMasteryView(input: {
  seasonId: string;
  rating: number;
  cardsCompleted: number;
  tier: Tier;
  history: readonly MatchScoreRecord[];
  fixtures: ReadonlyMap<string, Fixture>;
  clubs: ReadonlyMap<string, Club>;
}) {
  const { rating, cardsCompleted, tier, fixtures, clubs } = input;
  return {
    seasonId: input.seasonId,
    rating,
    tier,
    cardsCompleted,
    leaderboardEligible: isLeaderboardEligible(cardsCompleted),
    cardsForLeaderboard: MIN_CARDS_FOR_LEADERBOARD,
    next: nextTierProgress(tier, rating, cardsCompleted),
    history: input.history.map((h) => {
      const f = fixtures.get(h.fixtureId);
      const shortName = (id?: string) => (id && clubs.get(id)?.shortName) || '?';
      return {
        fixtureId: h.fixtureId,
        gameweek: f?.gameweek ?? null,
        kickoffAt: f?.kickoffAt ?? null,
        home: shortName(f?.homeClubId),
        away: shortName(f?.awayClubId),
        score: h.score,
        snapshotVersion: h.snapshotVersion,
        gradedAt: h.gradedAt,
      };
    }),
  };
}

/** Raw user ids stop here: a row carries the player's display name and whether it is the viewer. */
export function leaderboardView(input: {
  seasonId: string;
  rows: readonly LeaderboardRow[];
  nameOf: (userId: string) => string;
  viewerId: string | undefined;
}) {
  const ranked = rankEntries(input.rows.map((r) => ({ ...r, points: r.rating })));
  return {
    seasonId: input.seasonId,
    minCards: MIN_CARDS_FOR_LEADERBOARD,
    entries: ranked.map((r) => ({
      rank: r.rank,
      displayName: input.nameOf(r.userId),
      rating: r.rating,
      tier: r.tier,
      cardsCompleted: r.cardsCompleted,
      isYou: r.userId === input.viewerId,
    })),
  };
}
