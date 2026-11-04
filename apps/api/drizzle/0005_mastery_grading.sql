ALTER TABLE "analysis_card" ADD COLUMN "graded_version" integer;--> statement-breakpoint
ALTER TABLE "analysis_card" ADD COLUMN "graded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_question" ADD COLUMN "resolution" jsonb;