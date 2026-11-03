import type { PlayerMatchStats, Position, SquadPick } from './types';

/** Points table for per-match fantasy scoring. Tune freely; all scoring reads from here. */
export const FANTASY_POINTS = {
  appearance: 1,
  played60: 1,
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 } satisfies Record<Position, number>,
  assist: 3,
  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 } satisfies Record<Position, number>,
  savesPerPoint: 3,
  penaltySaved: 5,
  penaltyMissed: -2,
  /** GK and DEF lose a point for every this many goals conceded. */
  concededPerPenalty: 2,
  ownGoal: -2,
  yellowCard: -1,
  redCard: -3,
  captainMultiplier: 2,
  viceCaptainMultiplier: 1.5,
} as const;

export interface PointsBreakdownItem {
  label: string;
  points: number;
}

export interface PlayerPoints {
  playerId: string;
  points: number;
  breakdown: PointsBreakdownItem[];
}

export function scorePlayer(position: Position, s: PlayerMatchStats): PlayerPoints {
  const t = FANTASY_POINTS;
  const items: PointsBreakdownItem[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) items.push({ label, points });
  };

  if (s.minutes > 0) add('Appearance', t.appearance);
  if (s.minutes >= 60) add('Played 60+ minutes', t.played60);
  add(`Goals (${s.goals})`, s.goals * t.goal[position]);
  add(`Assists (${s.assists})`, s.assists * t.assist);
  if (s.minutes >= 60 && s.goalsConceded === 0) add('Clean sheet', t.cleanSheet[position]);
  if (position === 'GK') add(`Saves (${s.saves})`, Math.floor(s.saves / t.savesPerPoint));
  add('Penalties saved', s.penaltiesSaved * t.penaltySaved);
  add('Penalties missed', s.penaltiesMissed * t.penaltyMissed);
  if (position === 'GK' || position === 'DEF') {
    add('Goals conceded', -Math.floor(s.goalsConceded / t.concededPerPenalty));
  }
  add('Own goals', s.ownGoals * t.ownGoal);
  add('Yellow cards', s.yellowCards * t.yellowCard);
  add('Red cards', s.redCards * t.redCard);

  return {
    playerId: s.playerId,
    points: items.reduce((sum, i) => sum + i.points, 0),
    breakdown: items,
  };
}

/**
 * Total for a squad given each player's points. Captain scores 2x and vice-captain 1.5x.
 * If the captain did not play, the vice-captain takes the 2x instead.
 */
export function scoreSquad(
  pick: SquadPick,
  pointsByPlayer: ReadonlyMap<string, number>,
  minutesByPlayer: ReadonlyMap<string, number>,
): number {
  const captainPlayed = (minutesByPlayer.get(pick.captainId) ?? 0) > 0;
  let total = 0;
  for (const id of pick.playerIds) {
    const base = pointsByPlayer.get(id) ?? 0;
    let multiplier = 1;
    if (id === pick.captainId) multiplier = FANTASY_POINTS.captainMultiplier;
    else if (id === pick.viceCaptainId) {
      multiplier = captainPlayed
        ? FANTASY_POINTS.viceCaptainMultiplier
        : FANTASY_POINTS.captainMultiplier;
    }
    total += base * multiplier;
  }
  return Math.round(total * 10) / 10;
}

/** Standard competition ranking (1, 2, 2, 4) for a contest leaderboard, highest points first. */
export function rankEntries<T extends { points: number }>(
  entries: readonly T[],
): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => b.points - a.points);
  let rank = 0;
  let previous: number | undefined;
  return sorted.map((entry, index) => {
    if (entry.points !== previous) rank = index + 1;
    previous = entry.points;
    return { ...entry, rank };
  });
}
