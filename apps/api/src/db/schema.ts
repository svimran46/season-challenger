import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Season Challenger database schema (PostgreSQL 16).
 * Football reference data is synced from the feed and keyed by our own ids, with the
 * provider's id kept in provider_ref. Scoring and grading always record which stats
 * snapshot version they used, so a stats correction can be regraded without double counting.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const positionEnum = pgEnum('position', ['GK', 'DEF', 'MID', 'FWD']);
export const fixtureStatusEnum = pgEnum('fixture_status', ['scheduled', 'live', 'finished']);
export const contestFormatEnum = pgEnum('contest_format', [
  'head_to_head',
  'small_league',
  'mega',
  'private',
]);
export const contestStatusEnum = pgEnum('contest_status', [
  'open',
  'locked',
  'settled',
  'cancelled',
]);
export const ledgerKindEnum = pgEnum('ledger_kind', [
  'sign_up_bonus',
  'promotion',
  'reward',
  'contest_entry',
  'entry_refund',
  'contest_settlement',
  'voucher_redemption',
  'voucher_refund',
]);
export const voucherCategoryEnum = pgEnum('voucher_category', ['shop', 'travel']);
export const tierEnum = pgEnum('tier', ['Scout', 'Analyst', 'Tactician', 'Master', 'Grandmaster']);
export const leagueRoleEnum = pgEnum('league_role', ['owner', 'member']);

// ---------------------------------------------------------------- football reference data

export const season = pgTable('season', {
  id: text('id').primaryKey(),
  competition: text('competition').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  gameweeks: integer('gameweeks').notNull(),
  isActive: boolean('is_active').notNull().default(false),
});

export const club = pgTable('club', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  colour: text('colour').notNull(),
  crestUrl: text('crest_url'),
  providerRef: text('provider_ref'),
});

export const player = pgTable(
  'player',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => club.id),
    name: text('name').notNull(),
    position: positionEnum('position').notNull(),
    credits: numeric('credits', { precision: 4, scale: 1, mode: 'number' }).notNull(),
    providerRef: text('provider_ref'),
  },
  (t) => [index('player_club_idx').on(t.clubId)],
);

export const fixture = pgTable(
  'fixture',
  {
    id: text('id').primaryKey(),
    seasonId: text('season_id')
      .notNull()
      .references(() => season.id),
    gameweek: integer('gameweek').notNull(),
    homeClubId: text('home_club_id')
      .notNull()
      .references(() => club.id),
    awayClubId: text('away_club_id')
      .notNull()
      .references(() => club.id),
    kickoffAt: timestamp('kickoff_at', { withTimezone: true }).notNull(),
    status: fixtureStatusEnum('status').notNull().default('scheduled'),
    providerRef: text('provider_ref'),
  },
  (t) => [
    index('fixture_season_gameweek_idx').on(t.seasonId, t.gameweek),
    check('fixture_distinct_clubs', sql`${t.homeClubId} <> ${t.awayClubId}`),
  ],
);

/** Raw feed stats, append-only. Grading reads a specific version. */
export const statsSnapshot = pgTable(
  'stats_snapshot',
  {
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    version: integer('version').notNull(),
    isFinal: boolean('is_final').notNull().default(false),
    payload: jsonb('payload').notNull(),
    receivedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.fixtureId, t.version] })],
);

export const playerMatchPoints = pgTable(
  'player_match_points',
  {
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    playerId: text('player_id')
      .notNull()
      .references(() => player.id),
    snapshotVersion: integer('snapshot_version').notNull(),
    points: integer('points').notNull(),
    breakdown: jsonb('breakdown').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fixtureId, t.playerId, t.snapshotVersion] })],
);

// ---------------------------------------------------------------- users

export const appUser = pgTable('app_user', {
  /** Our player id. In development it is the x-user-id header value. */
  id: text('id').primaryKey(),
  /** Subject id from the managed auth provider. */
  authId: text('auth_id').notNull().unique(),
  /** Chosen by the player after sign-up. */
  displayName: text('display_name'),
  favouriteClubId: text('favourite_club_id').references(() => club.id),
  /** Self-declared at sign-up (18+ only); replaced by the ID document's date once verified. */
  birthDate: date('birth_date'),
  /** Set when the national ID or passport check passes. Required before redeeming vouchers. */
  idVerifiedAt: timestamp('id_verified_at', { withTimezone: true }),
  /** Keyed hash of the document number: one identity can verify only one account. */
  idDocumentHash: text('id_document_hash').unique(),
  /** Paused while an account is reviewed, e.g. for multi-accounting. */
  redemptionsBlocked: boolean('redemptions_blocked').notNull().default(false),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- phone sign-in

/**
 * Codes and session tokens are stored only as keyed hashes. No foreign keys to app_user: that
 * row is created lazily by the economy code, together with the sign-up bonus.
 */

/** One player per phone number (E.164, e.g. +8801712345678), and one number per player. */
export const phoneIdentity = pgTable('phone_identity', {
  phone: text('phone').primaryKey(),
  userId: text('user_id').notNull().unique(),
  createdAt: createdAt(),
});

/** A one-time code sent by SMS. Consumed once; refused after too many wrong guesses. */
export const otpChallenge = pgTable(
  'otp_challenge',
  {
    id: text('id').primaryKey(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Wrong guesses so far. */
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('otp_challenge_phone_idx').on(t.phone, t.createdAt)],
);

/** A signed-in device. The bearer token itself is never stored. */
export const authSession = pgTable(
  'auth_session',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('auth_session_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- fantasy

export const squad = pgTable(
  'squad',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    captainId: text('captain_id')
      .notNull()
      .references(() => player.id),
    viceCaptainId: text('vice_captain_id')
      .notNull()
      .references(() => player.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('squad_user_fixture_uq').on(t.userId, t.fixtureId),
    check('squad_captain_not_vice', sql`${t.captainId} <> ${t.viceCaptainId}`),
  ],
);

export const squadPlayer = pgTable(
  'squad_player',
  {
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squad.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => player.id),
  },
  (t) => [primaryKey({ columns: [t.squadId, t.playerId] })],
);

/** A tournament on one match. Terms are frozen when it is created; entries pay coins only. */
export const contest = pgTable(
  'contest',
  {
    /** <fixture>~<template>~<copy> for public tournaments, <fixture>~private~<code> otherwise. */
    id: text('id').primaryKey(),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    name: text('name').notNull(),
    format: contestFormatEnum('format').notNull(),
    status: contestStatusEnum('status').notNull().default('open'),
    /** Private tournaments only. */
    inviteCode: text('invite_code').unique(),
    createdBy: text('created_by').references(() => appUser.id),
    /** Public tournaments: the template a full one is copied from. */
    templateKey: text('template_key'),
    entryFee: integer('entry_fee').notNull(),
    capacity: integer('capacity').notNull(),
    minEntries: integer('min_entries').notNull(),
    guaranteed: boolean('guaranteed').notNull().default(false),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    maxBonusShareBps: integer('max_bonus_share_bps').notNull(),
    /** PrizeTier[] from @season/wallet. */
    prizeTable: jsonb('prize_table').notNull(),
    entryCount: integer('entry_count').notNull().default(0),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('contest_fixture_idx').on(t.fixtureId, t.status),
    check('contest_entry_fee_positive', sql`${t.entryFee} > 0`),
    check(
      'contest_sizes',
      sql`${t.capacity} >= 2 and ${t.minEntries} between 2 and ${t.capacity} and ${t.entryCount} between 0 and ${t.capacity}`,
    ),
    check(
      'contest_invite_code_private_only',
      sql`(${t.format} = 'private') = (${t.inviteCode} is not null)`,
    ),
  ],
);

export const contestEntry = pgTable(
  'contest_entry',
  {
    /** <contest>:<user>, also the ledger key (entry:<id>), so a retried join cannot pay twice. */
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contest.id),
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    /** The SquadPick entered, frozen at entry. */
    squad: jsonb('squad').notNull(),
    squadId: uuid('squad_id').references(() => squad.id),
    entryTxnId: uuid('entry_txn_id')
      .notNull()
      .references(() => ledgerTransaction.id),
    points: real('points'),
    rank: integer('rank'),
    prize: integer('prize'),
    joinedAt: createdAt(),
  },
  (t) => [
    unique('contest_entry_user_uq').on(t.contestId, t.userId),
    unique('contest_entry_squad_uq').on(t.contestId, t.squadId),
    index('contest_entry_user_idx').on(t.userId, t.joinedAt),
  ],
);

// ---------------------------------------------------------------- coin ledger

/**
 * Append-only, double-entry coin ledger. Coins never convert to or from money. Postings in a
 * transaction sum to zero; ledger_balance caches each account's total and is locked
 * (SELECT ... FOR UPDATE) while a transaction is checked and written.
 */
export const ledgerTransaction = pgTable('ledger_transaction', {
  id: uuid('id').primaryKey().defaultRandom(),
  sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  kind: ledgerKindEnum('kind').notNull(),
  meta: jsonb('meta').notNull().default({}),
  createdAt: createdAt(),
});

export const ledgerPosting = pgTable(
  'ledger_posting',
  {
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransaction.id),
    /** user:<id>:bonus, user:<id>:winnings, contest:<id>:pool or system:<name>. */
    account: text('account').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.account] }),
    index('ledger_posting_account_idx').on(t.account),
    check('ledger_posting_nonzero', sql`${t.amount} <> 0`),
  ],
);

export const ledgerBalance = pgTable(
  'ledger_balance',
  {
    account: text('account').primaryKey(),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ledger_balance_non_negative', sql`${t.balance} >= 0 or ${t.account} like 'system:%'`),
  ],
);

/** One row per user per Dhaka calendar day; drives streaks for the daily reward. */
export const dailyCheckIn = pgTable(
  'daily_check_in',
  {
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    localDate: date('local_date').notNull(),
    streak: integer('streak').notNull(),
    rewardTxnId: uuid('reward_txn_id')
      .notNull()
      .references(() => ledgerTransaction.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

// ---------------------------------------------------------------- vouchers

export const voucherPartner = pgTable('voucher_partner', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: voucherCategoryEnum('category').notNull(),
  contactEmail: text('contact_email'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** A discount a partner offers for won coins. validateOffer() in @season/wallet runs on save. */
export const voucherOffer = pgTable(
  'voucher_offer',
  {
    id: text('id').primaryKey(),
    partnerId: text('partner_id')
      .notNull()
      .references(() => voucherPartner.id),
    category: voucherCategoryEnum('category').notNull(),
    title: text('title').notNull(),
    terms: text('terms').notNull(),
    costCoins: integer('cost_coins').notNull(),
    /** VoucherDiscount from @season/wallet. */
    discount: jsonb('discount').notNull(),
    validForDays: integer('valid_for_days').notNull(),
    stock: integer('stock'),
    perUserMonthlyLimit: integer('per_user_monthly_limit').notNull().default(1),
    availableFrom: timestamp('available_from', { withTimezone: true }).notNull(),
    availableUntil: timestamp('available_until', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('voucher_offer_category_idx').on(t.category, t.active),
    check('voucher_offer_cost_positive', sql`${t.costCoins} > 0`),
    check('voucher_offer_stock', sql`${t.stock} is null or ${t.stock} >= 0`),
    check('voucher_offer_validity', sql`${t.validForDays} between 1 and 180`),
    check('voucher_offer_monthly_limit', sql`${t.perUserMonthlyLimit} >= 1`),
  ],
);

/** An issued voucher, bound to the account that redeemed it. */
export const voucher = pgTable(
  'voucher',
  {
    /** The redemption id; the ledger key is voucher:<id>. */
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    offerId: text('offer_id')
      .notNull()
      .references(() => voucherOffer.id),
    partnerId: text('partner_id')
      .notNull()
      .references(() => voucherPartner.id),
    partnerName: text('partner_name').notNull(),
    category: voucherCategoryEnum('category').notNull(),
    title: text('title').notNull(),
    /** Snapshot of the offer's partner, category and discount when issued. */
    discount: jsonb('discount').notNull(),
    costCoins: integer('cost_coins').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** The partner's receipt or booking reference. */
    usedReference: text('used_reference'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    redemptionTxnId: uuid('redemption_txn_id')
      .notNull()
      .references(() => ledgerTransaction.id),
    refundTxnId: uuid('refund_txn_id').references(() => ledgerTransaction.id),
  },
  (t) => [
    index('voucher_user_idx').on(t.userId, t.issuedAt),
    check(
      'voucher_used_or_cancelled',
      sql`not (${t.usedAt} is not null and ${t.cancelledAt} is not null)`,
    ),
    check('voucher_expiry_after_issue', sql`${t.expiresAt} > ${t.issuedAt}`),
  ],
);

// ---------------------------------------------------------------- Season Mastery

/** Reusable call types. resolver_key maps to grading code in @season/shared. */
export const questionTemplate = pgTable('question_template', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  prompt: text('prompt').notNull(),
  resolverKey: text('resolver_key').notNull(),
  paramsSchema: jsonb('params_schema').notNull().default({}),
});

export const analysisCard = pgTable('analysis_card', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: text('fixture_id')
    .notNull()
    .unique()
    .references(() => fixture.id),
  opensAt: timestamp('opens_at', { withTimezone: true }).notNull(),
  locksAt: timestamp('locks_at', { withTimezone: true }).notNull(),
});

export const cardQuestion = pgTable(
  'card_question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => analysisCard.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => questionTemplate.id),
    position: integer('position').notNull(),
    params: jsonb('params').notNull(),
  },
  (t) => [unique('card_question_position_uq').on(t.cardId, t.position)],
);

export const cardAnswer = pgTable(
  'card_answer',
  {
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => cardQuestion.id, { onDelete: 'cascade' }),
    answer: jsonb('answer').notNull(),
    /** Filled by grading: 0-100 accuracy and the crowd weight applied. */
    accuracy: real('accuracy'),
    weight: real('weight'),
    snapshotVersion: integer('snapshot_version'),
    answeredAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);

export const masteryMatchScore = pgTable(
  'mastery_match_score',
  {
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    score: real('score').notNull(),
    snapshotVersion: integer('snapshot_version').notNull(),
    gradedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fixtureId] })],
);

export const masterySeason = pgTable(
  'mastery_season',
  {
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    seasonId: text('season_id')
      .notNull()
      .references(() => season.id),
    rating: real('rating').notNull().default(0),
    cardsCompleted: integer('cards_completed').notNull().default(0),
    tier: tierEnum('tier').notNull().default('Scout'),
    streak: integer('streak').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seasonId] }),
    index('mastery_season_rating_idx').on(t.seasonId, t.rating),
  ],
);

// ---------------------------------------------------------------- leagues

export const league = pgTable('league', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: text('season_id')
    .notNull()
    .references(() => season.id),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: createdAt(),
});

export const leagueMember = pgTable(
  'league_member',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => appUser.id),
    role: leagueRoleEnum('role').notNull().default('member'),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);
