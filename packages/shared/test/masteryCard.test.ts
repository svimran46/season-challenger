import { describe, expect, it } from 'vitest';
import {
  generateCard,
  gradeCard,
  gradingContext,
  MAX_CALLS_PER_CARD,
  MIN_CALLS_PER_CARD,
  questionFromRow,
  questionToRow,
  seasonStanding,
  validateAnswers,
  type CardSource,
  type Player,
} from '../src';

const positions = [
  'GK',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'MID',
  'MID',
  'MID',
  'FWD',
  'FWD',
  'FWD',
] as const;
const squad = (clubId: string): Player[] =>
  positions.map((position, i) => ({
    id: `${clubId}-p${i}`,
    clubId,
    name: `${clubId} ${i}`,
    position,
    credits: 5 + i / 2,
  }));
const source = (id = 'fx-1'): CardSource => ({
  fixture: { id, homeClubId: 'h', awayClubId: 'a' },
  home: { id: 'h', name: 'Home', shortName: 'HOM', colour: '#000' },
  away: { id: 'a', name: 'Away', shortName: 'AWY', colour: '#fff' },
  players: [...squad('h'), ...squad('a')],
});

describe('generateCard', () => {
  it('makes 5 to 8 calls, the same every time for a match', () => {
    const card = generateCard(source());
    expect(card.length).toBeGreaterThanOrEqual(MIN_CALLS_PER_CARD);
    expect(card.length).toBeLessThanOrEqual(MAX_CALLS_PER_CARD);
    expect(generateCard(source())).toEqual(card);
  });

  it('still makes a card when the squads are empty, with no player calls', () => {
    const card = generateCard({ ...source(), players: [] });
    expect(card.length).toBeGreaterThanOrEqual(MIN_CALLS_PER_CARD);
    const kinds = card.map((c) => c.question.kind);
    expect(kinds).not.toContain('topPlayer');
    expect(kinds).not.toContain('playerDuel');
  });

  it('survives being stored and read back', () => {
    for (const { question } of generateCard(source())) {
      const { resolverKey, params } = questionToRow(question);
      expect(questionFromRow(resolverKey, params)).toEqual(question);
    }
  });
});

describe('validateAnswers', () => {
  it('needs every call answered, with answers that are on the card', () => {
    const calls = generateCard(source()).map((c, i) => ({ id: `q${i}`, question: c.question }));
    const check = validateAnswers(calls, [
      { questionId: 'nope', answer: { kind: 'comparison', pick: 'home' } },
    ]);
    expect(check.valid).toBe(false);
    expect(check.errors.map((e) => e.code)).toContain('unknown_question');
    expect(check.errors.filter((e) => e.code === 'missing_answer')).toHaveLength(calls.length);
  });
});

describe('gradeCard', () => {
  it('weighs a right call that went against the crowd more heavily', () => {
    const calls = [{ id: 'q', question: { kind: 'comparison', metric: 'corners' } as const }];
    const team = { goals: 1, halfTimeGoals: 0, shots: 5, shotsOnTarget: 2, possession: 50 };
    const snapshot = {
      fixtureId: 'fx-1',
      version: 3,
      isFinal: true,
      home: { clubId: 'h', corners: 8, ...team },
      away: { clubId: 'a', corners: 2, ...team },
      players: [],
    };
    const pick = (userId: string, side: 'home' | 'away') => ({
      userId,
      answers: new Map([['q', { kind: 'comparison', pick: side } as const]]),
    });
    const grade = gradeCard(
      calls,
      [pick('rare', 'home'), pick('b', 'away'), pick('c', 'away'), pick('d', 'away')],
      gradingContext(snapshot, []),
    );
    expect(grade.snapshotVersion).toBe(3);
    expect(grade.resolutions[0]?.resolution).toMatchObject({ actual: 'home', home: 8, away: 2 });
    const rare = grade.submissions.find((s) => s.userId === 'rare')!;
    const common = grade.submissions.find((s) => s.userId === 'b')!;
    expect(rare.calls[0]!.weight).toBeGreaterThan(common.calls[0]!.weight);
  });
});

describe('seasonStanding', () => {
  it('does not take away a tier already held', () => {
    expect(seasonStanding([], 'Analyst')).toMatchObject({ cardsCompleted: 0, tier: 'Analyst' });
  });
});
