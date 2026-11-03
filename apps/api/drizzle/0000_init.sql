CREATE TYPE "public"."contest_type" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'live', 'finished');--> statement-breakpoint
CREATE TYPE "public"."league_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('GK', 'DEF', 'MID', 'FWD');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('Scout', 'Analyst', 'Tactician', 'Master', 'Grandmaster');--> statement-breakpoint
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_auth_id_unique" UNIQUE("auth_id")
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
	"type" "contest_type" DEFAULT 'public' NOT NULL,
	"invite_code" text,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "contest_entry" (
	"contest_id" uuid NOT NULL,
	"squad_id" uuid NOT NULL,
	"points" real,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_entry_contest_id_squad_id_pk" PRIMARY KEY("contest_id","squad_id")
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
ALTER TABLE "analysis_card" ADD CONSTRAINT "analysis_card_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_favourite_club_id_club_id_fk" FOREIGN KEY ("favourite_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_answer" ADD CONSTRAINT "card_answer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_answer" ADD CONSTRAINT "card_answer_question_id_card_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."card_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_question" ADD CONSTRAINT "card_question_card_id_analysis_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."analysis_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_question" ADD CONSTRAINT "card_question_template_id_question_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."question_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest" ADD CONSTRAINT "contest_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_home_club_id_club_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_away_club_id_club_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "contest_fixture_idx" ON "contest" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX "fixture_season_gameweek_idx" ON "fixture" USING btree ("season_id","gameweek");--> statement-breakpoint
CREATE INDEX "mastery_season_rating_idx" ON "mastery_season" USING btree ("season_id","rating");--> statement-breakpoint
CREATE INDEX "player_club_idx" ON "player" USING btree ("club_id");