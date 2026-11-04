CREATE TABLE "external_identity" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_identity_provider_subject_pk" PRIMARY KEY("provider","subject"),
	CONSTRAINT "external_identity_provider_user" UNIQUE("provider","user_id")
);
