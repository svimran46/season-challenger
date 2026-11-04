CREATE TABLE "id_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_type" text NOT NULL,
	"layout" text NOT NULL,
	"status" text NOT NULL,
	"images" jsonb NOT NULL,
	"birth_date" date NOT NULL,
	"document_number_sealed" text,
	"document_hash" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"rejection_reason" text,
	"images_purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "id_submission_user_idx" ON "id_submission" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "id_submission_status_idx" ON "id_submission" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "id_submission_one_pending_uq" ON "id_submission" USING btree ("user_id") WHERE "id_submission"."status" = 'pending';