import { scorePlayer } from './fantasyPoints';
import type { FixtureStatus, Player, StatsSnapshot, TeamMatchStats } from './types';

/**
 * Season Mastery: before kickoff a user answers an analysis card of calls about a fixture.
 * After full time every call is graded 0-100 against the stats snapshot, combined into a
 * match score, and match scores roll up into a season rating and tier.
 */

export type Side = 'home' | 'away';
export type Outcome = 'home' | 'draw' | 'away';
export type TeamMetric = 'goals' | 'shots' | 'shotsOnTarget' | 'possession' | 'corners';
export type PlayerMetric = 'goals' | 'assists' | 'tackles' | 'dribbles' | 'saves';

export type Question =
  | { kind: 'outcome' }
  | { kind: 'halfTimeLeader' }
  | { kind: 'range'; metric: TeamMetric; side: Side | 'total'; maxWidth: number }
  | { kind: 'comparison'; metric: TeamMetric }
  | {
      kind: 'playerDuel';
      a: { playerId: string; metric: PlayerMetric };
      b: { playerId: string; metric: PlayerMetric };
    }
  | { kind: 'topPlayer'; candidateIds: readonly string[] };

export type Answer =
  | { kind: 'outcome'; pick: Outcome; /** 1/3 to 1 */ confidence: number }
  | { kind: 'halfTimeLeader'; pick: Outcome }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'comparison'; pick: Side }
  | { kind: 'playerDuel'; pick: 'a' | 'b' }
  | { kind: 'topPlayer'; playerId: string };

export interface GradingContext {
  snapshot: StatsSnapshot;
  /** Fantasy points per player for this fixture, used by topPlayer calls. */
  fantasyPoints: ReadonlyMap<string, number>;
}

export class AnswerMismatchError extends Error {
  constructor(question: Question['kind'], answer: Answer['kind']) {
    super(`Answer of kind "${answer}" does not fit question of kind "${question}".`);
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function teamValue(team: TeamMatchStats, metric: TeamMetric): number {
  return team[metric];
}

function outcomeOf(home: number, away: number): Outcome {
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

function rangeActual(question: Extract<Question, { kind: 'range' }>, s: StatsSnapshot): number {
  return question.side === 'total'
    ? teamValue(s.home, question.metric) + teamValue(s.away, question.metric)
    : teamValue(question.side === 'home' ? s.home : s.away, question.metric);
}

function duelValues(
  question: Extract<Question, { kind: 'playerDuel' }>,
  s: StatsSnapshot,
): { a: number; b: number } {
  const stat = (id: string, metric: PlayerMetric) =>
    s.players.find((p) => p.playerId === id)?.[metric] ?? 0;
  return {
    a: stat(question.a.playerId, question.a.metric),
    b: stat(question.b.playerId, question.b.metric),
  };
}

/**
 * Outcome calls use a multi-class Brier score so confidence matters: a confident right call
 * scores 100, a hedged right call less, a confident wrong call 0.
 */
export function outcomeAccuracy(pick: Outcome, confidence: number, actual: Outcome): number {
  const c = clamp(confidence, 1 / 3, 1);
  const others = (1 - c) / 2;
  let brier = 0;
  for (const o of ['home', 'draw', 'away'] as const) {
    const p = o === pick ? c : others;
    const y = o === actual ? 1 : 0;
    brier += (p - y) ** 2;
  }
  return Math.round(100 * (1 - brier / 2) * 10) / 10;
}

/** Range calls: a miss scores 0; a hit scores 60 for the widest allowed range, up to 100 for exact. */
export function rangeAccuracy(min: number, max: number, actual: number, maxWidth: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (actual < lo || actual > hi) return 0;
  const width = clamp(hi - lo, 0, maxWidth);
  const narrowness = maxWidth === 0 ? 1 : 1 - width / maxWidth;
  return Math.round((60 + 40 * narrowness) * 10) / 10;
}

export function gradeAnswer(question: Question, answer: Answer, ctx: GradingContext): number {
  if (question.kind !== answer.kind) throw new AnswerMismatchError(question.kind, answer.kind);
  const { home, away } = ctx.snapshot;

  switch (question.kind) {
    case 'outcome': {
      const a = answer as Extract<Answer, { kind: 'outcome' }>;
      return outcomeAccuracy(a.pick, a.confidence, outcomeOf(home.goals, away.goals));
    }
    case 'halfTimeLeader': {
      const a = answer as Extract<Answer, { kind: 'halfTimeLeader' }>;
      return a.pick === outcomeOf(home.halfTimeGoals, away.halfTimeGoals) ? 100 : 0;
    }
    case 'range': {
      const a = answer as Extract<Answer, { kind: 'range' }>;
      return rangeAccuracy(a.min, a.max, rangeActual(question, ctx.snapshot), question.maxWidth);
    }
    case 'comparison': {
      const a = answer as Extract<Answer, { kind: 'comparison' }>;
      const h = teamValue(home, question.metric);
      const w = teamValue(away, question.metric);
      if (h === w) return 50;
      return (h > w ? 'home' : 'away') === a.pick ? 100 : 0;
    }
    case 'playerDuel': {
      const a = answer as Extract<Answer, { kind: 'playerDuel' }>;
      const { a: va, b: vb } = duelValues(question, ctx.snapshot);
      if (va === vb) return 50;
      return (va > vb ? 'a' : 'b') === a.pick ? 100 : 0;
    }
    case 'topPlayer': {
      const a = answer as Extract<Answer, { kind: 'topPlayer' }>;
      const scores = question.candidateIds.map((id) => ctx.fantasyPoints.get(id) ?? 0);
      const mine = ctx.fantasyPoints.get(a.playerId) ?? 0;
      if (!question.candidateIds.includes(a.playerId)) return 0;
      const better = new Set(scores.filter((s) => s > mine)).size;
      if (better === 0) return 100;
      if (better === 1) return 50;
      return 0;
    }
  }
}

/** What actually happened for a call. Stored at grading, so a later correction cannot rewrite it. */
export type CallResolution =
  | { kind: 'outcome'; actual: Outcome; home: number; away: number }
  | { kind: 'halfTimeLeader'; actual: Outcome; home: number; away: number }
  | { kind: 'range'; actual: number }
  | { kind: 'comparison'; actual: Side | 'tie'; home: number; away: number }
  | { kind: 'playerDuel'; actual: 'a' | 'b' | 'tie'; a: number; b: number }
  | { kind: 'topPlayer'; best: string[]; points: Record<string, number> };

export function resolveCall(question: Question, ctx: GradingContext): CallResolution {
  const { home, away } = ctx.snapshot;
  switch (question.kind) {
    case 'outcome':
      return {
        kind: 'outcome',
        actual: outcomeOf(home.goals, away.goals),
        home: home.goals,
        away: away.goals,
      };
    case 'halfTimeLeader':
      return {
        kind: 'halfTimeLeader',
        actual: outcomeOf(home.halfTimeGoals, away.halfTimeGoals),
        home: home.halfTimeGoals,
        away: away.halfTimeGoals,
      };
    case 'range':
      return { kind: 'range', actual: rangeActual(question, ctx.snapshot) };
    case 'comparison': {
      const h = teamValue(home, question.metric);
      const w = teamValue(away, question.metric);
      return {
        kind: 'comparison',
        actual: h === w ? 'tie' : h > w ? 'home' : 'away',
        home: h,
        away: w,
      };
    }
    case 'playerDuel': {
      const { a, b } = duelValues(question, ctx.snapshot);
      return { kind: 'playerDuel', actual: a === b ? 'tie' : a > b ? 'a' : 'b', a, b };
    }
    case 'topPlayer': {
      const points: Record<string, number> = {};
      for (const id of question.candidateIds) points[id] = ctx.fantasyPoints.get(id) ?? 0;
      const top = Math.max(...Object.values(points));
      return {
        kind: 'topPlayer',
        best: question.candidateIds.filter((id) => points[id] === top),
        points,
      };
    }
  }
}

/** Fantasy points for everyone in a snapshot, which topPlayer calls compare. */
export function gradingContext(
  snapshot: StatsSnapshot,
  players: readonly Player[],
): GradingContext {
  const positionOf = new Map(players.map((p) => [p.id, p.position]));
  const fantasyPoints = new Map<string, number>();
  for (const s of snapshot.players) {
    const position = positionOf.get(s.playerId);
    if (position) fantasyPoints.set(s.playerId, scorePlayer(position, s).points);
  }
  return { snapshot, fantasyPoints };
}

/**
 * The categorical key used to measure how the crowd answered. Range calls have no single
 * key, so they get a neutral crowd share.
 */
export function crowdKey(answer: Answer): string | null {
  switch (answer.kind) {
    case 'outcome':
    case 'halfTimeLeader':
    case 'comparison':
    case 'playerDuel':
      return answer.pick;
    case 'topPlayer':
      return answer.playerId;
    case 'range':
      return null;
  }
}

export const NEUTRAL_CROWD_SHARE = 0.5;
export const DEFAULT_LAMBDA = 0.5;

/** w = 1 + λ(1 − p): a call the crowd disagreed with counts for more. */
export function callWeight(crowdShare: number, lambda = DEFAULT_LAMBDA): number {
  return 1 + lambda * (1 - clamp(crowdShare, 0, 1));
}

/** Share of all answers to a question that match each crowd key. */
export function crowdShares(answers: readonly Answer[]): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const a of answers) {
    const key = crowdKey(a);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const shares = new Map<string, number>();
  for (const [key, count] of counts) shares.set(key, count / total);
  return shares;
}

export interface GradedCall {
  accuracy: number;
  weight: number;
}

/** Weighted average of call accuracies, 0-100. */
export function matchScore(calls: readonly GradedCall[]): number {
  const totalWeight = calls.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const score = calls.reduce((sum, c) => sum + c.weight * c.accuracy, 0) / totalWeight;
  return Math.round(score * 10) / 10;
}

export interface CardCall {
  id: string;
  question: Question;
}

export interface CardSubmission {
  userId: string;
  /** Answer by question id. */
  answers: ReadonlyMap<string, Answer>;
}

export interface GradedSubmission {
  userId: string;
  score: number;
  calls: (GradedCall & { questionId: string })[];
}

export interface CardGrade {
  snapshotVersion: number;
  resolutions: { questionId: string; resolution: CallResolution }[];
  submissions: GradedSubmission[];
}

/**
 * Grades one match: every call for every player, weighted by how that question's whole crowd
 * answered, which is why the submissions are graded together.
 */
export function gradeCard(
  calls: readonly CardCall[],
  submissions: readonly CardSubmission[],
  ctx: GradingContext,
): CardGrade {
  const sharesOf = new Map(
    calls.map((c) => [c.id, crowdShares(submissions.flatMap((s) => s.answers.get(c.id) ?? []))]),
  );
  return {
    snapshotVersion: ctx.snapshot.version,
    resolutions: calls.map((c) => ({
      questionId: c.id,
      resolution: resolveCall(c.question, ctx),
    })),
    submissions: submissions.map((s) => {
      const graded = calls.flatMap((c) => {
        const answer = s.answers.get(c.id);
        if (!answer) return [];
        const key = crowdKey(answer);
        const share = key === null ? NEUTRAL_CROWD_SHARE : (sharesOf.get(c.id)?.get(key) ?? 0);
        return {
          questionId: c.id,
          accuracy: gradeAnswer(c.question, answer, ctx),
          weight: callWeight(share),
        };
      });
      return { userId: s.userId, score: matchScore(graded), calls: graded };
    }),
  };
}

export const RATING_DECAY = 0.9;

/**
 * Season rating: a decayed average of match scores, oldest first, so recent form counts more
 * but one bad week does not sink a season.
 */
export function seasonRating(matchScores: readonly number[], decay = RATING_DECAY): number {
  if (matchScores.length === 0) return 0;
  let weighted = 0;
  let weights = 0;
  const n = matchScores.length;
  matchScores.forEach((score, i) => {
    const w = decay ** (n - 1 - i);
    weighted += w * score;
    weights += w;
  });
  return Math.round((weighted / weights) * 10) / 10;
}

export const MIN_CARDS_FOR_LEADERBOARD = 5;

export function isLeaderboardEligible(cardsCompleted: number): boolean {
  return cardsCompleted >= MIN_CARDS_FOR_LEADERBOARD;
}

export const TIERS = ['Scout', 'Analyst', 'Tactician', 'Master', 'Grandmaster'] as const;
export type Tier = (typeof TIERS)[number];

/** Minimum rating and cards completed to reach each tier. */
export const TIER_THRESHOLDS: Record<Tier, { rating: number; cards: number }> = {
  Scout: { rating: 0, cards: 0 },
  Analyst: { rating: 40, cards: 5 },
  Tactician: { rating: 55, cards: 10 },
  Master: { rating: 68, cards: 20 },
  Grandmaster: { rating: 78, cards: 30 },
};

export function tierFor(rating: number, cardsCompleted: number): Tier {
  let tier: Tier = 'Scout';
  for (const t of TIERS) {
    const need = TIER_THRESHOLDS[t];
    if (rating >= need.rating && cardsCompleted >= need.cards) tier = t;
  }
  return tier;
}

/** Tiers only go up within a season. */
export function promote(current: Tier, earned: Tier): Tier {
  return TIERS.indexOf(earned) > TIERS.indexOf(current) ? earned : current;
}

/** At the start of a new season a user drops one tier (never below Scout). */
export function carryOverTier(previous: Tier): Tier {
  return TIERS[Math.max(0, TIERS.indexOf(previous) - 1)] ?? 'Scout';
}

export interface SeasonStanding {
  rating: number;
  cardsCompleted: number;
  tier: Tier;
}

/** A player's season after grading, from match scores oldest first and the tier held so far. */
export function seasonStanding(
  matchScoresOldestFirst: readonly number[],
  currentTier: Tier = 'Scout',
): SeasonStanding {
  const rating = seasonRating(matchScoresOldestFirst);
  const cardsCompleted = matchScoresOldestFirst.length;
  return { rating, cardsCompleted, tier: promote(currentTier, tierFor(rating, cardsCompleted)) };
}

export interface TierProgress {
  next: Tier;
  rating: { have: number; need: number };
  cards: { have: number; need: number };
  /** 0 to 1. A tier needs both, so this follows whichever is further from done. */
  share: number;
}

/** How far a player is from the tier above the one they hold; null at the top. */
export function nextTierProgress(
  current: Tier,
  rating: number,
  cardsCompleted: number,
): TierProgress | null {
  const next = TIERS[TIERS.indexOf(current) + 1];
  if (!next) return null;
  const need = TIER_THRESHOLDS[next];
  return {
    next,
    rating: { have: rating, need: need.rating },
    cards: { have: cardsCompleted, need: need.cards },
    share: Math.max(0, Math.min(1, rating / need.rating, cardsCompleted / need.cards)),
  };
}

/** A card can change until kick-off. The feed's status also locks it, if the match started early. */
export function isCardLocked(
  fixture: { kickoffAt: string; status: FixtureStatus },
  now: Date,
): boolean {
  return fixture.status !== 'scheduled' || now.getTime() >= Date.parse(fixture.kickoffAt);
}
