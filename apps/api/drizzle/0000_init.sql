CREATE TYPE "public"."contest_format" AS ENUM('head_to_head', 'small_league', 'mega', 'private');--> statement-breakpoint
CREATE TYPE "public"."contest_status" AS ENUM('open', 'locked', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'live', 'finished');--> statement-breakpoint
CREATE TYPE "public"."league_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('sign_up_bonus', 'promotion', 'reward', 'contest_entry', 'entry_refund', 'contest_settlement', 'voucher_redemption', 'voucher_refund');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('GK', 'DEF', 'MID', 'FWD');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('Scout', 'Analyst', 'Tactician', 'Master', 'Grandmaster');--> statement-breakpoint
CREATE TYPE "public"."voucher_category" AS ENUM('shop', 'travel');--> statement-breakpoint
CREATE TABLE "analysis_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_id" text NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analysis_card_fixture_id_unique" UNIQUE("fixture_id")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"display_name" text NOT NULL,
	"favourite_club_id" text,
	"birth_date" date,
	"id_verified_at" timestamp with time zone,
	"id_document_hash" text,
	"redemptions_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "app_user_id_document_hash_unique" UNIQUE("id_document_hash")
);
--> statement-breakpoint
CREATE TABLE "card_answer" (
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"accuracy" real,
	"weight" real,
	"snapshot_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_answer_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "card_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"position" integer NOT NULL,
	"params" jsonb NOT NULL,
	CONSTRAINT "card_question_position_uq" UNIQUE("card_id","position")
);
--> statement-breakpoint
CREATE TABLE "club" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"colour" text NOT NULL,
	"crest_url" text,
	"provider_ref" text
);
--> statement-breakpoint
CREATE TABLE "contest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_id" text NOT NULL,
	"name" text NOT NULL,
	"format" "contest_format" NOT NULL,
	"status" "contest_status" DEFAULT 'open' NOT NULL,
	"invite_code" text,
	"created_by" uuid,
	"entry_fee" integer NOT NULL,
	"capacity" integer NOT NULL,
	"min_entries" integer NOT NULL,
	"guaranteed" boolean DEFAULT false NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"max_bonus_share_bps" integer NOT NULL,
	"prize_table" jsonb NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "contest_invite_code_unique" UNIQUE("invite_code"),
	CONSTRAINT "contest_entry_fee_positive" CHECK ("contest"."entry_fee" > 0),
	CONSTRAINT "contest_sizes" CHECK ("contest"."capacity" >= 2 and "contest"."min_entries" between 2 and "contest"."capacity" and "contest"."entry_count" between 0 and "contest"."capacity"),
	CONSTRAINT "contest_invite_code_private_only" CHECK (("contest"."format" = 'private') = ("contest"."invite_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "contest_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"squad_id" uuid NOT NULL,
	"entry_txn_id" uuid NOT NULL,
	"points" real,
	"rank" integer,
	"prize" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_entry_user_uq" UNIQUE("contest_id","user_id"),
	CONSTRAINT "contest_entry_squad_uq" UNIQUE("contest_id","squad_id")
);
--> statement-breakpoint
CREATE TABLE "daily_check_in" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"streak" integer NOT NULL,
	"reward_txn_id" uuid NOT NULL,
	CONSTRAINT "daily_check_in_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "fixture" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"gameweek" integer NOT NULL,
	"home_club_id" text NOT NULL,
	"away_club_id" text NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"status" "fixture_status" DEFAULT 'scheduled' NOT NULL,
	"provider_ref" text,
	CONSTRAINT "fixture_distinct_clubs" CHECK ("fixture"."home_club_id" <> "fixture"."away_club_id")
);
--> statement-breakpoint
CREATE TABLE "league" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" text NOT NULL,
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "league_member" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "league_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_member_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_balance" (
	"account" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_balance_non_negative" CHECK ("ledger_balance"."balance" >= 0 or "ledger_balance"."account" like 'system:%')
);
--> statement-breakpoint
CREATE TABLE "ledger_posting" (
	"transaction_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "ledger_posting_transaction_id_account_pk" PRIMARY KEY("transaction_id","account"),
	CONSTRAINT "ledger_posting_nonzero" CHECK ("ledger_posting"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transaction_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "ledger_transaction_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mastery_match_score" (
	"user_id" uuid NOT NULL,
	"fixture_id" text NOT NULL,
	"score" real NOT NULL,
	"snapshot_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_match_score_user_id_fixture_id_pk" PRIMARY KEY("user_id","fixture_id")
);
--> statement-breakpoint
CREATE TABLE "mastery_season" (
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"rating" real DEFAULT 0 NOT NULL,
	"cards_completed" integer DEFAULT 0 NOT NULL,
	"tier" "tier" DEFAULT 'Scout' NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_season_user_id_season_id_pk" PRIMARY KEY("user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"name" text NOT NULL,
	"position" "position" NOT NULL,
	"credits" numeric(4, 1) NOT NULL,
	"provider_ref" text
);
--> statement-breakpoint
CREATE TABLE "player_match_points" (
	"fixture_id" text NOT NULL,
	"player_id" text NOT NULL,
	"snapshot_version" integer NOT NULL,
	"points" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	CONSTRAINT "player_match_points_fixture_id_player_id_snapshot_version_pk" PRIMARY KEY("fixture_id","player_id","snapshot_version")
);
--> statement-breakpoint
CREATE TABLE "question_template" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"resolver_key" text NOT NULL,
	"params_schema" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" text PRIMARY KEY NOT NULL,
	"competition" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"gameweeks" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fixture_id" text NOT NULL,
	"captain_id" text NOT NULL,
	"vice_captain_id" text NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_user_fixture_uq" UNIQUE("user_id","fixture_id"),
	CONSTRAINT "squad_captain_not_vice" CHECK ("squad"."captain_id" <> "squad"."vice_captain_id")
);
--> statement-breakpoint
CREATE TABLE "squad_player" (
	"squad_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	CONSTRAINT "squad_player_squad_id_player_id_pk" PRIMARY KEY("squad_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "stats_snapshot" (
	"fixture_id" text NOT NULL,
	"version" integer NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_snapshot_fixture_id_version_pk" PRIMARY KEY("fixture_id","version")
);
--> statement-breakpoint
CREATE TABLE "voucher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"title" text NOT NULL,
	"discount" jsonb NOT NULL,
	"cost_coins" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_reference" text,
	"cancelled_at" timestamp with time zone,
	"redemption_txn_id" uuid NOT NULL,
	"refund_txn_id" uuid,
	CONSTRAINT "voucher_code_unique" UNIQUE("code"),
	CONSTRAINT "voucher_used_or_cancelled" CHECK (not ("voucher"."used_at" is not null and "voucher"."cancelled_at" is not null)),
	CONSTRAINT "voucher_expiry_after_issue" CHECK ("voucher"."expires_at" > "voucher"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "voucher_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"category" "voucher_category" NOT NULL,
	"title" text NOT NULL,
	"terms" text NOT NULL,
	"cost_coins" integer NOT NULL,
	"discount" jsonb NOT NULL,
	"valid_for_days" integer NOT NULL,
	"stock" integer,
	"per_user_monthly_limit" integer DEFAULT 1 NOT NULL,
	"available_from" timestamp with time zone NOT NULL,
	"available_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_offer_cost_positive" CHECK ("voucher_offer"."cost_coins" > 0),
	CONSTRAINT "voucher_offer_stock" CHECK ("voucher_offer"."stock" is null or "voucher_offer"."stock" >= 0),
	CONSTRAINT "voucher_offer_validity" CHECK ("voucher_offer"."valid_for_days" between 1 and 180),
	CONSTRAINT "voucher_offer_monthly_limit" CHECK ("voucher_offer"."per_user_monthly_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "voucher_partner" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "voucher_category" NOT NULL,
	"contact_email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_card" ADD CONSTRAINT "analysis_card_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_favourite_club_id_club_id_fk" FOREIGN KEY ("favourite_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_answer" ADD CONSTRAINT "card_answer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_answer" ADD CONSTRAINT "card_answer_question_id_card_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."card_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_question" ADD CONSTRAINT "card_question_card_id_analysis_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."analysis_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_question" ADD CONSTRAINT "card_question_template_id_question_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."question_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest" ADD CONSTRAINT "contest_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest" ADD CONSTRAINT "contest_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_entry_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("entry_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_check_in" ADD CONSTRAINT "daily_check_in_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_check_in" ADD CONSTRAINT "daily_check_in_reward_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("reward_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_home_club_id_club_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_away_club_id_club_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_match_score" ADD CONSTRAINT "mastery_match_score_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_match_score" ADD CONSTRAINT "mastery_match_score_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_season" ADD CONSTRAINT "mastery_season_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_season" ADD CONSTRAINT "mastery_season_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_points" ADD CONSTRAINT "player_match_points_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_points" ADD CONSTRAINT "player_match_points_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_captain_id_player_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_vice_captain_id_player_id_fk" FOREIGN KEY ("vice_captain_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_player" ADD CONSTRAINT "squad_player_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_player" ADD CONSTRAINT "squad_player_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_snapshot" ADD CONSTRAINT "stats_snapshot_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_offer_id_voucher_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."voucher_offer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_partner_id_voucher_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."voucher_partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_redemption_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("redemption_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_refund_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("refund_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_offer" ADD CONSTRAINT "voucher_offer_partner_id_voucher_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."voucher_partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contest_fixture_idx" ON "contest" USING btree ("fixture_id","status");--> statement-breakpoint
CREATE INDEX "contest_entry_user_idx" ON "contest_entry" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "fixture_season_gameweek_idx" ON "fixture" USING btree ("season_id","gameweek");--> statement-breakpoint
CREATE INDEX "ledger_posting_account_idx" ON "ledger_posting" USING btree ("account");--> statement-breakpoint
CREATE INDEX "mastery_season_rating_idx" ON "mastery_season" USING btree ("season_id","rating");--> statement-breakpoint
CREATE INDEX "player_club_idx" ON "player" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "voucher_user_idx" ON "voucher" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "voucher_offer_category_idx" ON "voucher_offer" USING btree ("category","active");