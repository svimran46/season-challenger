import {
  buildPrizeTable,
  DEFAULT_MAX_BONUS_SHARE_BPS,
  DEFAULT_PLATFORM_FEE_BPS,
  validateContest,
  type ContestTerms,
  type PrizeShape,
} from './contests';
import { WalletError } from './errors';

/**
 * Tournament categories. Every tournament is played on one match: entrants build a squad for
 * that fixture and the best fantasy score wins. Season-long competition lives in Season
 * Mastery and leagues, not here.
 */
export type ContestFormat = 'head_to_head' | 'small_league' | 'mega' | 'private';
export const CONTEST_FORMATS: readonly ContestFormat[] = [
  'head_to_head',
  'small_league',
  'mega',
  'private',
];

export interface FormatRules {
  label: string;
  summary: string;
  minCapacity: number;
  maxCapacity: number;
  defaultCapacity: number;
  /** A guaranteed tournament runs and pays its full prizes even if it does not fill. */
  guaranteed: boolean;
  /** Only people with the invite code can join. */
  inviteOnly: boolean;
  shape: (capacity: number) => PrizeShape;
}

export const FORMAT_RULES: Record<ContestFormat, FormatRules> = {
  head_to_head: {
    label: 'Head-to-head',
    summary: 'You against one other player. The higher score takes the prize.',
    minCapacity: 2,
    maxCapacity: 2,
    defaultCapacity: 2,
    guaranteed: false,
    inviteOnly: false,
    shape: () => ({ kind: 'winner_takes_all' }),
  },
  small_league: {
    label: 'Small league',
    summary: 'Up to 20 players. The top three share the prizes.',
    minCapacity: 3,
    maxCapacity: 20,
    defaultCapacity: 10,
    guaranteed: false,
    inviteOnly: false,
    shape: () => ({ kind: 'top_three' }),
  },
  mega: {
    label: 'Mega tournament',
    summary: 'Hundreds or thousands of players, a guaranteed prize table, the top quarter win.',
    minCapacity: 50,
    maxCapacity: 100_000,
    defaultCapacity: 1_000,
    guaranteed: true,
    inviteOnly: false,
    shape: () => ({ kind: 'top_share', paidShareBps: 2500 }),
  },
  private: {
    label: 'Private',
    summary: 'Your own tournament for friends, joined by invite code.',
    minCapacity: 2,
    maxCapacity: 50,
    defaultCapacity: 10,
    guaranteed: false,
    inviteOnly: true,
    shape: (capacity) => (capacity < 3 ? { kind: 'winner_takes_all' } : { kind: 'top_three' }),
  },
};

export interface ContestSetup extends ContestTerms {
  format: ContestFormat;
  inviteOnly: boolean;
  platformFeeBps: number;
}

export interface ContestSetupInput {
  id: string;
  format: ContestFormat;
  entryFee: number;
  capacity?: number;
  /** Mega tournaments only: the fewest entries for it to run. Defaults to a tenth of capacity. */
  minEntries?: number;
  platformFeeBps?: number;
  maxBonusShareBps?: number;
}

/** Builds and validates a tournament of the given category. */
export function contestSetup(input: ContestSetupInput): ContestSetup {
  const rules = FORMAT_RULES[input.format];
  if (!rules) throw new WalletError('invalid_contest', `Unknown format ${String(input.format)}.`);
  const capacity = input.capacity ?? rules.defaultCapacity;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < rules.minCapacity ||
    capacity > rules.maxCapacity
  ) {
    throw new WalletError(
      'invalid_contest',
      `${rules.label} holds ${rules.minCapacity} to ${rules.maxCapacity} players, not ${capacity}.`,
    );
  }
  const platformFeeBps = input.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;
  if (!Number.isSafeInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 5_000) {
    throw new WalletError('invalid_contest', 'Platform fee must be 0 to 5000 bps.');
  }
  if (input.minEntries !== undefined && !rules.guaranteed) {
    throw new WalletError('invalid_contest', `${rules.label} only runs when full.`);
  }
  const minEntries = rules.guaranteed
    ? (input.minEntries ?? Math.max(2, Math.floor(capacity / 10)))
    : capacity;

  const setup: ContestSetup = {
    id: input.id,
    format: input.format,
    inviteOnly: rules.inviteOnly,
    entryFee: input.entryFee,
    capacity,
    minEntries,
    guaranteed: rules.guaranteed,
    platformFeeBps,
    maxBonusShareBps: input.maxBonusShareBps ?? DEFAULT_MAX_BONUS_SHARE_BPS,
    prizeTable: [],
  };
  if (!Number.isSafeInteger(input.entryFee) || input.entryFee <= 0) {
    throw new WalletError('invalid_contest', 'Entry fee must be a positive whole number of coins.');
  }
  setup.prizeTable = buildPrizeTable(
    rules.shape(capacity),
    input.entryFee,
    capacity,
    platformFeeBps,
  );
  validateContest(setup);
  return setup;
}
