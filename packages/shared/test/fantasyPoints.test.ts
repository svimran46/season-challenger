import { describe, expect, it } from 'vitest';
import { rankEntries, scorePlayer, scoreSquad } from '../src';
import { stats } from './fixtures';

describe('scorePlayer', () => {
  it('scores a forward goal and assist', () => {
    const r = scorePlayer('FWD', stats('p', { goals: 1, assists: 1, goalsConceded: 1 }));
    // appearance 1 + 60 mins 1 + goal 4 + assist 3
    expect(r.points).toBe(9);
  });

  it('gives a defender a clean sheet only after 60 minutes', () => {
    expect(scorePlayer('DEF', stats('p')).points).toBe(6);
    expect(scorePlayer('DEF', stats('p', { minutes: 45 })).points).toBe(1);
  });

  it('scores goalkeeper saves, a penalty save and goals conceded', () => {
    const r = scorePlayer('GK', stats('p', { saves: 7, penaltiesSaved: 1, goalsConceded: 3 }));
    // 1 + 1 + saves 2 + pen save 5 - conceded 1
    expect(r.points).toBe(8);
    expect(r.breakdown.map((b) => b.label)).toContain('Penalties saved');
  });

  it('applies cards and own goals', () => {
    const r = scorePlayer(
      'MID',
      stats('p', { yellowCards: 1, redCards: 1, ownGoals: 1, goalsConceded: 2 }),
    );
    expect(r.points).toBe(1 + 1 - 1 - 3 - 2);
  });

  it('gives nothing to an unused substitute', () => {
    expect(scorePlayer('MID', stats('p', { minutes: 0 })).points).toBe(0);
  });
});

describe('scoreSquad', () => {
  const pick = { fixtureId: 'f', playerIds: ['c', 'v', 'x'], captainId: 'c', viceCaptainId: 'v' };
  const points = new Map([
    ['c', 10],
    ['v', 4],
    ['x', 3],
  ]);

  it('doubles the captain and gives the vice-captain 1.5x', () => {
    const minutes = new Map([
      ['c', 90],
      ['v', 90],
      ['x', 90],
    ]);
    expect(scoreSquad(pick, points, minutes)).toBe(20 + 6 + 3);
  });

  it('promotes the vice-captain to 2x when the captain did not play', () => {
    const minutes = new Map([
      ['c', 0],
      ['v', 90],
      ['x', 90],
    ]);
    expect(scoreSquad(pick, new Map([...points, ['c', 0]]), minutes)).toBe(0 + 8 + 3);
  });
});

describe('rankEntries', () => {
  it('uses standard competition ranking for ties', () => {
    const ranked = rankEntries([
      { id: 'a', points: 50 },
      { id: 'b', points: 70 },
      { id: 'c', points: 50 },
      { id: 'd', points: 10 },
    ]);
    expect(ranked.map((e) => [e.id, e.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });
});
