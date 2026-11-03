import { sql } from 'drizzle-orm';
import {
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
export const contestTypeEnum = pgEnum('contest_type', ['public', 'private']);
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
  id: uuid('id').primaryKey().defaultRandom(),
  /** Subject id from the managed auth provider. */
  authId: text('auth_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  favouriteClubId: text('favourite_club_id').references(() => club.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- fantasy

export const squad = pgTable(
  'squad',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
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

export const contest = pgTable(
  'contest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixture.id),
    name: text('name').notNull(),
    type: contestTypeEnum('type').notNull().default('public'),
    inviteCode: text('invite_code').unique(),
    capacity: integer('capacity'),
    createdAt: createdAt(),
  },
  (t) => [index('contest_fixture_idx').on(t.fixtureId)],
);

export const contestEntry = pgTable(
  'contest_entry',
  {
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contest.id, { onDelete: 'cascade' }),
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squad.id),
    points: real('points'),
    rank: integer('rank'),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contestId, t.squadId] })],
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
    userId: uuid('user_id')
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
    userId: uuid('user_id')
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
    userId: uuid('user_id')
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
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    role: leagueRoleEnum('role').notNull().default('member'),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);
