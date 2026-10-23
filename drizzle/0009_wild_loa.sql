CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" varchar(60) NOT NULL,
	"target_type" varchar(40),
	"target_id" varchar(80),
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"owner_id" integer,
	"purpose" varchar(30) NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"size_bytes" integer NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"delete_after" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" USING btree ("action");