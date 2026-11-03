import { describe, expect, it } from 'vitest';
import {
  CONTEST_FORMATS,
  contestSetup,
  FORMAT_RULES,
  totalPrizes,
  WalletError,
  type ContestFormat,
} from '../src';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

describe('contestSetup', () => {
  it('builds a valid tournament for every category at its default size', () => {
    for (const format of CONTEST_FORMATS) {
      const setup = contestSetup({ id: format, format, entryFee: 50 });
      expect(setup.capacity).toBe(FORMAT_RULES[format].defaultCapacity);
      expect(totalPrizes(setup.prizeTable)).toBe(
        Math.floor((50 * setup.capacity * (10_000 - setup.platformFeeBps)) / 10_000),
      );
    }
  });

  it('shapes prizes per category', () => {
    const h2h = contestSetup({ id: 'a', format: 'head_to_head', entryFee: 100 });
    expect(h2h.prizeTable).toEqual([{ fromRank: 1, toRank: 1, amount: 170 }]);
    expect(h2h.minEntries).toBe(2);

    const league = contestSetup({ id: 'b', format: 'small_league', entryFee: 20, capacity: 5 });
    expect(league.prizeTable.map((t) => t.amount)).toEqual([43, 25, 17]);
    expect(league.minEntries).toBe(5);

    const mega = contestSetup({ id: 'c', format: 'mega', entryFee: 10, capacity: 1_000 });
    expect(mega.guaranteed).toBe(true);
    expect(mega.minEntries).toBe(100);
    expect(mega.prizeTable.at(-1)?.toRank).toBe(250);

    const pair = contestSetup({ id: 'd', format: 'private', entryFee: 30, capacity: 2 });
    expect(pair.inviteOnly).toBe(true);
    expect(pair.prizeTable).toHaveLength(1);
  });

  it('refuses sizes and settings outside the category rules', () => {
    const bad: [ContestFormat, number][] = [
      ['head_to_head', 3],
      ['small_league', 2],
      ['small_league', 21],
      ['mega', 49],
      ['private', 51],
    ];
    for (const [format, capacity] of bad) {
      expect(code(() => contestSetup({ id: 'x', format, entryFee: 10, capacity }))).toBe(
        'invalid_contest',
      );
    }
    expect(code(() => contestSetup({ id: 'x', format: 'small_league', entryFee: 0 }))).toBe(
      'invalid_contest',
    );
    expect(
      code(() => contestSetup({ id: 'x', format: 'small_league', entryFee: 10, minEntries: 3 })),
    ).toBe('invalid_contest');
    expect(
      code(() =>
        contestSetup({ id: 'x', format: 'head_to_head', entryFee: 10, platformFeeBps: 6_000 }),
      ),
    ).toBe('invalid_contest');
  });
});
