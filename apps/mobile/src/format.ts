/** "Sat 15 Aug, 14:00" in the device's locale and time zone. */
export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "2d 4h", "3h 20m" or "12m" until a deadline; "Locked" once passed. */
export function countdown(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'Locked';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** "1 pt", "0 pts", "-1 pts". */
export function formatPoints(points: number): string {
  return `${points} ${points === 1 ? 'pt' : 'pts'}`;
}

/** "1,250 coins", "1 coin". */
export function formatCoins(coins: number): string {
  return `${coins.toLocaleString('en-US')} ${coins === 1 ? 'coin' : 'coins'}`;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "5 Oct" in the device's locale. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
