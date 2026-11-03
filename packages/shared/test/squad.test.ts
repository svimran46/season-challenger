import { describe, expect, it } from 'vitest';
import { validateSquad, type SquadPick } from '../src';
import { player, twoClubPool } from './fixtures';

const pool = twoClubPool();
// 1 GK, 4 DEF, 4 MID, 2 FWD; 6 from home, 5 from away.
const validIds = ['h0', 'h1', 'h2', 'a3', 'a4', 'h5', 'h6', 'a7', 'a8', 'h9', 'a10'];
const pick = (overrides: Partial<SquadPick> = {}): SquadPick => ({
  fixtureId: 'f1',
  playerIds: validIds,
  captainId: 'h9',
  viceCaptainId: 'a10',
  ...overrides,
});

const codes = (p: SquadPick, players = pool) => validateSquad(p, players).errors.map((e) => e.code);

describe('validateSquad', () => {
  it('accepts a valid squad and reports credits used', () => {
    const result = validateSquad(pick(), pool);
    expect(result).toEqual({ valid: true, errors: [], creditsUsed: 88 });
  });

  it('rejects the wrong number of players', () => {
    expect(codes(pick({ playerIds: validIds.slice(0, 10) }))).toContain('wrong_size');
  });

  it('rejects duplicates and unknown players', () => {
    expect(codes(pick({ playerIds: [...validIds.slice(0, 10), 'h0'] }))).toContain(
      'duplicate_player',
    );
    expect(codes(pick({ playerIds: [...validIds.slice(0, 10), 'zz'] }))).toContain(
      'unknown_player',
    );
  });

  it('rejects a squad over budget', () => {
    const pricey = pool.map((p) => ({ ...p, credits: 10 }));
    expect(codes(pick(), pricey)).toEqual(['over_budget']);
  });

  it('rejects more than 7 players from one club', () => {
    const extra = [player('h11', 'h', 'MID'), player('h12', 'h', 'DEF')];
    const ids = ['h0', 'h1', 'h2', 'h12', 'a4', 'h5', 'h6', 'h11', 'a8', 'h9', 'a10'];
    expect(codes(pick({ playerIds: ids }), [...pool, ...extra])).toEqual(['too_many_from_club']);
  });

  it('enforces formation limits', () => {
    // Two goalkeepers, three defenders.
    const ids = ['h0', 'a0', 'h1', 'h2', 'a3', 'h5', 'h6', 'a7', 'a8', 'h9', 'a10'];
    expect(codes(pick({ playerIds: ids }))).toEqual(['position_count']);
  });

  it('requires a distinct captain and vice-captain from the squad', () => {
    expect(codes(pick({ captainId: 'a9' }))).toContain('captain_not_in_squad');
    expect(codes(pick({ viceCaptainId: 'a9' }))).toContain('vice_captain_not_in_squad');
    expect(codes(pick({ viceCaptainId: 'h9' }))).toContain('captain_is_vice_captain');
  });
});
