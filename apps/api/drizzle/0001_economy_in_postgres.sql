-- Coins, tournaments and vouchers move into Postgres. Player, tournament and entry ids become
-- text (player ids come from sign-in, tournament ids are readable and deterministic), entries
-- keep their squad, and vouchers keep the partner and category they were issued with.
-- Uuid columns referenced by foreign keys cannot change type while the keys exist, so the keys
-- are dropped first and added back at the end. The new NOT NULL columns need these tables empty,
-- which they are: nothing wrote to them before this migration.
ALTER TABLE "card_answer" DROP CONSTRAINT "card_answer_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "contest" DROP CONSTRAINT "contest_created_by_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "contest_entry" DROP CONSTRAINT "contest_entry_contest_id_contest_id_fk";--> statement-breakpoint
ALTER TABLE "contest_entry" DROP CONSTRAINT "contest_entry_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "daily_check_in" DROP CONSTRAINT "daily_check_in_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "league_member" DROP CONSTRAINT "league_member_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "mastery_match_score" DROP CONSTRAINT "mastery_match_score_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "mastery_season" DROP CONSTRAINT "mastery_season_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "squad" DROP CONSTRAINT "squad_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "voucher" DROP CONSTRAINT "voucher_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_answer" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contest" ALTER COLUMN "created_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest_entry" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest_entry" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contest_entry" ALTER COLUMN "contest_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest_entry" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest_entry" ALTER COLUMN "squad_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_check_in" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "league_member" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mastery_match_score" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mastery_season" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "squad" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "voucher" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contest" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD COLUMN "squad" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher" ADD COLUMN "partner_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher" ADD COLUMN "category" "voucher_category" NOT NULL;--> statement-breakpoint
ALTER TABLE "card_answer" ADD CONSTRAINT "card_answer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest" ADD CONSTRAINT "contest_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_entry" ADD CONSTRAINT "contest_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_check_in" ADD CONSTRAINT "daily_check_in_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_match_score" ADD CONSTRAINT "mastery_match_score_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_season" ADD CONSTRAINT "mastery_season_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
