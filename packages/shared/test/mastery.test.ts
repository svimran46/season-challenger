import { describe, expect, it } from 'vitest';
import {
  AnswerMismatchError,
  callWeight,
  carryOverTier,
  crowdShares,
  gradeAnswer,
  isLeaderboardEligible,
  matchScore,
  outcomeAccuracy,
  promote,
  rangeAccuracy,
  seasonRating,
  tierFor,
  type Answer,
  type GradingContext,
} from '../src';
import { snapshot, stats, team } from './fixtures';

const ctx: GradingContext = {
  snapshot: snapshot({
    home: team('h', { goals: 2, halfTimeGoals: 0, shots: 14, possession: 58, corners: 6 }),
    away: team('a', { goals: 1, halfTimeGoals: 1, shots: 9, possession: 42, corners: 6 }),
    players: [
      stats('lb', { tackles: 4 }),
      stats('rw', { dribbles: 4 }),
      stats('st', { dribbles: 6 }),
    ],
  }),
  fantasyPoints: new Map([
    ['p1', 12],
    ['p2', 8],
    ['p3', 8],
    ['p4', 2],
  ]),
};

describe('outcome calls', () => {
  it('rewards confidence when right and punishes it when wrong', () => {
    expect(outcomeAccuracy('home', 1, 'home')).toBe(100);
    expect(outcomeAccuracy('home', 1, 'away')).toBe(0);
    expect(outcomeAccuracy('home', 0.7, 'home')).toBeGreaterThan(
      outcomeAccuracy('home', 0.5, 'home'),
    );
    expect(outcomeAccuracy('home', 1 / 3, 'away')).toBeCloseTo(66.7, 1);
  });

  it('grades against the final score', () => {
    expect(
      gradeAnswer({ kind: 'outcome' }, { kind: 'outcome', pick: 'home', confidence: 1 }, ctx),
    ).toBe(100);
  });
});

describe('range calls', () => {
  it('scores 0 for a miss and more for a narrower hit', () => {
    expect(rangeAccuracy(18, 24, 25, 10)).toBe(0);
    expect(rangeAccuracy(18, 28, 23, 10)).toBe(60);
    expect(rangeAccuracy(23, 23, 23, 10)).toBe(100);
    expect(rangeAccuracy(24, 18, 20, 10)).toBe(76);
  });

  it('resolves total shots from both teams', () => {
    const q = { kind: 'range', metric: 'shots', side: 'total', maxWidth: 10 } as const;
    expect(gradeAnswer(q, { kind: 'range', min: 20, max: 25 }, ctx)).toBe(80);
  });
});

describe('categorical calls', () => {
  it('grades half-time leader, comparisons and player duels', () => {
    expect(
      gradeAnswer({ kind: 'halfTimeLeader' }, { kind: 'halfTimeLeader', pick: 'away' }, ctx),
    ).toBe(100);
    expect(
      gradeAnswer(
        { kind: 'comparison', metric: 'possession' },
        { kind: 'comparison', pick: 'away' },
        ctx,
      ),
    ).toBe(0);
    // Corners are level: half credit for everyone.
    expect(
      gradeAnswer(
        { kind: 'comparison', metric: 'corners' },
        { kind: 'comparison', pick: 'home' },
        ctx,
      ),
    ).toBe(50);
    const duel = {
      kind: 'playerDuel',
      a: { playerId: 'lb', metric: 'tackles' },
      b: { playerId: 'st', metric: 'dribbles' },
    } as const;
    expect(gradeAnswer(duel, { kind: 'playerDuel', pick: 'b' }, ctx)).toBe(100);
  });

  it('gives top-player calls full credit for 1st and half for 2nd, including ties', () => {
    const q = { kind: 'topPlayer', candidateIds: ['p1', 'p2', 'p3', 'p4'] } as const;
    expect(gradeAnswer(q, { kind: 'topPlayer', playerId: 'p1' }, ctx)).toBe(100);
    expect(gradeAnswer(q, { kind: 'topPlayer', playerId: 'p3' }, ctx)).toBe(50);
    expect(gradeAnswer(q, { kind: 'topPlayer', playerId: 'p4' }, ctx)).toBe(0);
    expect(gradeAnswer(q, { kind: 'topPlayer', playerId: 'zz' }, ctx)).toBe(0);
  });

  it('refuses an answer that does not fit the question', () => {
    expect(() =>
      gradeAnswer({ kind: 'outcome' }, { kind: 'halfTimeLeader', pick: 'home' }, ctx),
    ).toThrow(AnswerMismatchError);
  });
});

describe('weights and match score', () => {
  it('weights contrarian calls more heavily', () => {
    expect(callWeight(1)).toBe(1);
    expect(callWeight(0.2)).toBeCloseTo(1.4);
    expect(callWeight(0, 1)).toBe(2);
  });

  it('computes crowd shares and ignores range answers', () => {
    const answers: Answer[] = [
      { kind: 'comparison', pick: 'home' },
      { kind: 'comparison', pick: 'home' },
      { kind: 'comparison', pick: 'home' },
      { kind: 'comparison', pick: 'away' },
      { kind: 'range', min: 1, max: 2 },
    ];
    const shares = crowdShares(answers);
    expect(shares.get('home')).toBe(0.75);
    expect(shares.get('away')).toBe(0.25);
  });

  it('takes a weighted average of call accuracies', () => {
    expect(matchScore([])).toBe(0);
    expect(
      matchScore([
        { accuracy: 100, weight: 1.5 },
        { accuracy: 0, weight: 0.5 },
      ]),
    ).toBe(75);
  });
});

describe('season rating and tiers', () => {
  it('leans toward recent form', () => {
    expect(seasonRating([])).toBe(0);
    expect(seasonRating([50, 50, 50])).toBe(50);
    expect(seasonRating([20, 80])).toBeGreaterThan(50);
  });

  it('needs five cards to enter the leaderboard', () => {
    expect(isLeaderboardEligible(4)).toBe(false);
    expect(isLeaderboardEligible(5)).toBe(true);
  });

  it('assigns tiers from rating and cards, only promoting within a season', () => {
    expect(tierFor(90, 3)).toBe('Scout');
    expect(tierFor(56, 12)).toBe('Tactician');
    expect(tierFor(80, 30)).toBe('Grandmaster');
    expect(promote('Master', 'Analyst')).toBe('Master');
    expect(promote('Analyst', 'Master')).toBe('Master');
    expect(carryOverTier('Master')).toBe('Tactician');
    expect(carryOverTier('Scout')).toBe('Scout');
  });
});
