CREATE TABLE "grievance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"grievance_id" integer NOT NULL,
	"actor_id" integer,
	"kind" varchar(12) NOT NULL,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grievance_events" ADD CONSTRAINT "grievance_events_grievance_id_grievances_id_fk" FOREIGN KEY ("grievance_id") REFERENCES "public"."grievances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_events" ADD CONSTRAINT "grievance_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grievance_events_idx" ON "grievance_events" USING btree ("grievance_id","created_at");