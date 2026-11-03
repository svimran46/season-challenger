import type { Player, Position, SquadPick } from './types';

export interface SquadRules {
  size: number;
  maxCredits: number;
  maxPerClub: number;
  /** Inclusive [min, max] count per position. */
  positions: Record<Position, readonly [number, number]>;
}

export const DEFAULT_SQUAD_RULES: SquadRules = {
  size: 11,
  maxCredits: 100,
  maxPerClub: 7,
  positions: {
    GK: [1, 1],
    DEF: [3, 5],
    MID: [3, 5],
    FWD: [1, 3],
  },
};

export type SquadErrorCode =
  | 'wrong_size'
  | 'duplicate_player'
  | 'unknown_player'
  | 'over_budget'
  | 'too_many_from_club'
  | 'position_count'
  | 'captain_not_in_squad'
  | 'vice_captain_not_in_squad'
  | 'captain_is_vice_captain'
  | 'fixture_locked';

export interface SquadError {
  code: SquadErrorCode;
  message: string;
}

export interface SquadValidation {
  valid: boolean;
  errors: SquadError[];
  creditsUsed: number;
}

/**
 * Checks a squad against the rules for one fixture. `players` is the pool of
 * players available in that fixture (both clubs). The server runs this before
 * saving; the app runs it live as the user picks.
 */
export function validateSquad(
  pick: SquadPick,
  players: readonly Player[],
  rules: SquadRules = DEFAULT_SQUAD_RULES,
): SquadValidation {
  const errors: SquadError[] = [];
  const byId = new Map(players.map((p) => [p.id, p]));

  if (pick.playerIds.length !== rules.size) {
    errors.push({
      code: 'wrong_size',
      message: `Pick exactly ${rules.size} players (you have ${pick.playerIds.length}).`,
    });
  }

  const unique = new Set(pick.playerIds);
  if (unique.size !== pick.playerIds.length) {
    errors.push({ code: 'duplicate_player', message: 'A player can only be picked once.' });
  }

  const chosen: Player[] = [];
  for (const id of unique) {
    const player = byId.get(id);
    if (!player) {
      errors.push({ code: 'unknown_player', message: `Player ${id} is not in this fixture.` });
    } else {
      chosen.push(player);
    }
  }

  const creditsUsed = Math.round(chosen.reduce((sum, p) => sum + p.credits, 0) * 10) / 10;
  if (creditsUsed > rules.maxCredits) {
    errors.push({
      code: 'over_budget',
      message: `Squad costs ${creditsUsed} credits; the limit is ${rules.maxCredits}.`,
    });
  }

  const perClub = new Map<string, number>();
  for (const p of chosen) perClub.set(p.clubId, (perClub.get(p.clubId) ?? 0) + 1);
  for (const [clubId, count] of perClub) {
    if (count > rules.maxPerClub) {
      errors.push({
        code: 'too_many_from_club',
        message: `${count} players from club ${clubId}; the limit is ${rules.maxPerClub}.`,
      });
    }
  }

  for (const [position, [min, max]] of Object.entries(rules.positions) as [
    Position,
    readonly [number, number],
  ][]) {
    const count = chosen.filter((p) => p.position === position).length;
    if (count < min || count > max) {
      const range = min === max ? `exactly ${min}` : `${min} to ${max}`;
      errors.push({
        code: 'position_count',
        message: `Pick ${range} ${position} (you have ${count}).`,
      });
    }
  }

  if (!unique.has(pick.captainId)) {
    errors.push({ code: 'captain_not_in_squad', message: 'Your captain must be in the squad.' });
  }
  if (!unique.has(pick.viceCaptainId)) {
    errors.push({
      code: 'vice_captain_not_in_squad',
      message: 'Your vice-captain must be in the squad.',
    });
  }
  if (pick.captainId === pick.viceCaptainId) {
    errors.push({
      code: 'captain_is_vice_captain',
      message: 'Captain and vice-captain must be different players.',
    });
  }

  return { valid: errors.length === 0, errors, creditsUsed };
}
