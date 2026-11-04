CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_channel" AS ENUM('bkash', 'nagad', 'rocket', 'upay', 'bank');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'rejected', 'paid', 'failed');--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'deposit';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'deposit_refund';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'redeem';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'coin_to_cash';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'withdraw_hold';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'withdraw_release';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'withdraw_paid';--> statement-breakpoint
CREATE TABLE "deposit_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"gateway" text NOT NULL,
	"channel" "payout_channel" NOT NULL,
	"amount_bdt" integer NOT NULL,
	"coins" integer NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"checkout_url" text,
	"deposit_txn_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deposit_invoice_positive" CHECK ("deposit_invoice"."amount_bdt" > 0 and "deposit_invoice"."coins" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" text NOT NULL,
	"event_id" text NOT NULL,
	"invoice_id" text,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_event_uq" UNIQUE("gateway","event_id")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_bdt" integer NOT NULL,
	"channel" "payout_channel" NOT NULL,
	"destination" text NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"hold_txn_id" uuid NOT NULL,
	"release_txn_id" uuid,
	"paid_txn_id" uuid,
	"payout_reference" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_request_positive" CHECK ("withdrawal_request"."amount_bdt" > 0)
);
--> statement-breakpoint
ALTER TABLE "deposit_invoice" ADD CONSTRAINT "deposit_invoice_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_invoice" ADD CONSTRAINT "deposit_invoice_deposit_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("deposit_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook" ADD CONSTRAINT "payment_webhook_invoice_id_deposit_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."deposit_invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_hold_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("hold_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_release_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("release_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_paid_txn_id_ledger_transaction_id_fk" FOREIGN KEY ("paid_txn_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_invoice_user_idx" ON "deposit_invoice" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deposit_invoice_status_idx" ON "deposit_invoice" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_webhook_invoice_idx" ON "payment_webhook" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "withdrawal_request_user_idx" ON "withdrawal_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_request_status_idx" ON "withdrawal_request" USING btree ("status","created_at");