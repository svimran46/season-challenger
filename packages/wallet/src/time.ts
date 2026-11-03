/**
 * Calendar helpers in Bangladesh time. Daily rewards reset and monthly limits roll over at
 * local midnight in Dhaka, which is UTC+6 all year (no daylight saving since 2009).
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local date in Dhaka, as YYYY-MM-DD. */
export function dhakaDate(now: Date): string {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The local month in Dhaka, as YYYY-MM. Monthly redemption limits count within it. */
export function dhakaMonth(now: Date): string {
  return dhakaDate(now).slice(0, 7);
}

export function isCalendarDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Whole years between a birth date and a day, both YYYY-MM-DD. */
export function ageOn(birthDate: string, onDate: string): number {
  if (!isCalendarDate(birthDate) || !isCalendarDate(onDate)) {
    throw new RangeError(`Expected YYYY-MM-DD dates, got ${birthDate} and ${onDate}.`);
  }
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  const hadBirthday = m > bm || (m === bm && d >= bd);
  return y - by - (hadBirthday ? 0 : 1);
}

/** The day after a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
