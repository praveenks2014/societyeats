CREATE TABLE "message_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" varchar(10) NOT NULL,
	"user_id" integer,
	"to_phone" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"event_key" varchar(40),
	"status" varchar(10) DEFAULT 'mock' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"marketing_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" varchar(40);--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_outbox_user_idx" ON "message_outbox" USING btree ("user_id","created_at");