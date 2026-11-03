import { describe, expect, it } from 'vitest';
import {
  ageOn,
  dailyCheckIn,
  dailyCheckInAmount,
  dhakaDate,
  dhakaMonth,
  InMemoryLedger,
  masteryCardReward,
  nextStreak,
  signUpBonus,
  SYSTEM,
  walletOf,
  WalletError,
} from '../src';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WalletError).code;
  }
  return undefined;
};

describe('Dhaka calendar', () => {
  it('rolls the day over at midnight Bangladesh time, not UTC', () => {
    expect(dhakaDate(new Date('2026-11-03T17:59:59Z'))).toBe('2026-11-03');
    expect(dhakaDate(new Date('2026-11-03T18:00:00Z'))).toBe('2026-11-04');
    expect(dhakaMonth(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12');
  });

  it('counts age in whole years, birthday included', () => {
    expect(ageOn('2008-11-04', '2026-11-03')).toBe(17);
    expect(ageOn('2008-11-04', '2026-11-04')).toBe(18);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(() => ageOn('2008-02-30', '2026-03-01')).toThrow(RangeError);
  });
});

describe('free coins', () => {
  it('gives each account one 500-coin sign-up bonus, which is not redeemable', () => {
    const ledger = new InMemoryLedger();
    ledger.post(signUpBonus('u1'));
    ledger.post(signUpBonus('u1'));
    expect(walletOf(ledger, 'u1')).toEqual({ bonus: 500, winnings: 0, total: 500, redeemable: 0 });
    expect(ledger.balance(SYSTEM.promotions)).toBe(-500);
  });

  it('tracks check-in streaks and adds a bonus every seventh day', () => {
    expect(nextStreak(null, '2026-11-03')).toEqual({ streak: 1, alreadyCheckedIn: false });
    expect(nextStreak({ date: '2026-11-03', streak: 1 }, '2026-11-04').streak).toBe(2);
    expect(nextStreak({ date: '2026-11-03', streak: 4 }, '2026-11-03')).toEqual({
      streak: 4,
      alreadyCheckedIn: true,
    });
    expect(nextStreak({ date: '2026-11-03', streak: 6 }, '2026-11-05').streak).toBe(1);
    expect(nextStreak({ date: '2026-12-31', streak: 6 }, '2027-01-01').streak).toBe(7);
    expect(code(() => nextStreak({ date: '2026-11-05', streak: 1 }, '2026-11-03'))).toBe(
      'invalid_reward',
    );
    expect([1, 6, 7, 8, 14].map((s) => dailyCheckInAmount(s))).toEqual([20, 20, 70, 20, 70]);
  });

  it('pays the daily reward once per day and the Mastery reward once per card', () => {
    const ledger = new InMemoryLedger();
    ledger.post(dailyCheckIn('u1', '2026-11-03', 1));
    ledger.post(dailyCheckIn('u1', '2026-11-03', 1));
    ledger.post(dailyCheckIn('u1', '2026-11-04', 2));
    ledger.post(masteryCardReward('u1', 'card-1'));
    ledger.post(masteryCardReward('u1', 'card-1'));
    expect(walletOf(ledger, 'u1')).toMatchObject({ bonus: 55, winnings: 0, redeemable: 0 });
    expect(ledger.balance(SYSTEM.rewards)).toBe(-55);
    expect(code(() => dailyCheckIn('u1', '3 Nov', 1))).toBe('invalid_reward');
    expect(code(() => dailyCheckIn('u1', '2026-11-05', 0))).toBe('invalid_reward');
  });
});
