CREATE TABLE IF NOT EXISTS "admin_kitchen_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"sender_role" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"attachments_json" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_kitchen_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"subject" varchar(200) NOT NULL,
	"created_by_admin_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kitchen_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"plan_id" integer,
	"plan_name_snapshot" varchar(80),
	"duration_months_snapshot" integer DEFAULT 0 NOT NULL,
	"price_paise_snapshot" integer DEFAULT 0 NOT NULL,
	"gst_paise" integer DEFAULT 0 NOT NULL,
	"gst_bps_snapshot" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"status" varchar(20) DEFAULT 'pending_payment' NOT NULL,
	"razorpay_order_id" varchar(80),
	"razorpay_payment_id" varchar(80),
	"paid_at" timestamp,
	"refunded_paise" integer DEFAULT 0 NOT NULL,
	"granted_by_admin_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"duration_months" integer NOT NULL,
	"price_paise" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_status" varchar(12) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_reason_category" varchar(30);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_note" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderated_at" timestamp;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "approved_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "listing_state" varchar(20) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "listing_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "listing_review_note" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "delist_reason_category" varchar(30);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "delisted_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_vpa" varchar(80);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_name" varchar(120);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "accepts_upi_now" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "accepts_pay_at_pickup" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_kitchen_messages" ADD CONSTRAINT "admin_kitchen_messages_thread_id_admin_kitchen_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."admin_kitchen_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_kitchen_messages" ADD CONSTRAINT "admin_kitchen_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_kitchen_threads" ADD CONSTRAINT "admin_kitchen_threads_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_kitchen_threads" ADD CONSTRAINT "admin_kitchen_threads_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kitchen_subscriptions" ADD CONSTRAINT "kitchen_subscriptions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kitchen_subscriptions" ADD CONSTRAINT "kitchen_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kitchen_subscriptions" ADD CONSTRAINT "kitchen_subscriptions_granted_by_admin_id_users_id_fk" FOREIGN KEY ("granted_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "akm_thread_idx" ON "admin_kitchen_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "akt_seller_idx" ON "admin_kitchen_threads" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kitchen_subs_seller_idx" ON "kitchen_subscriptions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kitchen_subs_rzp_idx" ON "kitchen_subscriptions" USING btree ("razorpay_order_id");