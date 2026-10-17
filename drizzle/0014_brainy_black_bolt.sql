CREATE TABLE IF NOT EXISTS "fssai_funnel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"stage" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fssai_walkthrough_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"lang" varchar(4) DEFAULT 'en' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"tip" text,
	"screenshot_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "form_a_json" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fssai_funnel_events" ADD CONSTRAINT "fssai_funnel_events_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fssai_funnel_seller_stage_idx" ON "fssai_funnel_events" USING btree ("seller_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fssai_steps_lang_idx" ON "fssai_walkthrough_steps" USING btree ("lang","sort");