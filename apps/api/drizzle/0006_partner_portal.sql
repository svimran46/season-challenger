CREATE TYPE "public"."partner_staff_role" AS ENUM('owner', 'cashier');--> statement-breakpoint
CREATE TABLE "partner_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "partner_staff_role" DEFAULT 'cashier' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "voucher" ADD COLUMN "used_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "voucher" ADD COLUMN "used_request_id" text;--> statement-breakpoint
ALTER TABLE "partner_session" ADD CONSTRAINT "partner_session_staff_id_partner_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."partner_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_staff" ADD CONSTRAINT "partner_staff_partner_id_voucher_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."voucher_partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_session_staff_idx" ON "partner_session" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_used_by_staff_id_partner_staff_id_fk" FOREIGN KEY ("used_by_staff_id") REFERENCES "public"."partner_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voucher_partner_used_idx" ON "voucher" USING btree ("partner_id","used_at");--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_partner_request_uq" UNIQUE("partner_id","used_request_id");