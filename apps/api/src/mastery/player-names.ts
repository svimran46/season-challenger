import { inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Database } from '../db/client';
import { appUser } from '../db/schema';

/** Display names by user id. A player it does not know gets shortPlayerLabel. */
export type PlayerNames = (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;

/** A stand-in name that does not reveal the id it came from: "Player 3FA9". */
export function shortPlayerLabel(userId: string): string {
  const tag = createHash('sha256').update(userId).digest('hex').slice(0, 4).toUpperCase();
  return `Player ${tag}`;
}

/** Without a database nobody has a stored name yet. */
export const noPlayerNames: PlayerNames = async () => new Map();

export function pgPlayerNames(db: Database): PlayerNames {
  return async (userIds) => {
    if (userIds.length === 0) return new Map();
    const rows = await db
      .select({ id: appUser.id, displayName: appUser.displayName })
      .from(appUser)
      .where(inArray(appUser.id, [...userIds]));
    return new Map(rows.flatMap((r) => (r.displayName ? [[r.id, r.displayName] as const] : [])));
  };
}
