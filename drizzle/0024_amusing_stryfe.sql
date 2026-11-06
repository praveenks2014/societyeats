CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer,
	"audience_json" jsonb NOT NULL,
	"kind" varchar(10) NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"skipped_no_opt_in" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;