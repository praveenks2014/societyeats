CREATE TABLE "chat_reads" (
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_message_id" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "disclaimers" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"user_id" integer NOT NULL,
	"seller_id" integer NOT NULL,
	"notify_cooking" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grievances" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(24) NOT NULL,
	"order_id" integer,
	"raised_by_id" integer,
	"raised_role" varchar(8),
	"subject" varchar(200) NOT NULL,
	"body" text,
	"evidence_json" jsonb,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"ack_due_at" timestamp NOT NULL,
	"ack_at" timestamp,
	"resolve_due_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"resolution" varchar(30),
	"resolution_note" text,
	"handled_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"slug" varchar(40) PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"reconsent_required" boolean DEFAULT false NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"for_date" varchar(10) NOT NULL,
	"note" varchar(200),
	"listing_ids_json" jsonb NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(60) NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "society_access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"society_name" varchar(160) NOT NULL,
	"city" varchar(80),
	"contact_name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(15),
	"message" text,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "society_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"society_id" integer NOT NULL,
	"tower" varchar(40),
	"flat" varchar(20),
	"status" varchar(12) DEFAULT 'approved' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(8) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"order_id" integer,
	"reason" text,
	"lifted_at" timestamp,
	"appealed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upi_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"provider" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'created' NOT NULL,
	"claimed_vpa" varchar(80) NOT NULL,
	"verified_vpa" varchar(80),
	"registered_name" varchar(160),
	"name_match_score" integer,
	"masked_account" varchar(20),
	"ifsc" varchar(11),
	"bank_name" varchar(80),
	"razorpay_order_id" varchar(64),
	"razorpay_payment_id" varchar(64),
	"validation_id" varchar(64),
	"refund_id" varchar(64),
	"evidence_file_key" varchar(120),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "upi_verifications_razorpay_order_id_unique" UNIQUE("razorpay_order_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'fee_pending'::text;--> statement-breakpoint
UPDATE "orders" SET "status" = CASE "status" WHEN 'placed' THEN 'fee_pending' WHEN 'fee_paid' THEN 'booked' WHEN 'out_for_delivery' THEN 'on_the_way' WHEN 'awaiting_kitchen_payment_confirmation' THEN 'booked' ELSE "status" END;--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('fee_pending', 'booked', 'awaiting_kitchen_payment_confirmation', 'expired', 'paid', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up', 'cancelled', 'refund_pending', 'delivery_unassigned', 'at_door', 'collected', 'payment_claimed', 'completed', 'payment_disputed', 'closed_unpaid', 'cancelled_by_seller', 'cancelled_by_buyer', 'cancelled_auto', 'cancelled_buyer_unpaid', 'no_show_buyer');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'fee_pending'::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "referral_credits" ALTER COLUMN "referred_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_credits" ALTER COLUMN "referred_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "food_mark" varchar(10) DEFAULT 'veg' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ingredients" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "allergens_json" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "allergens_declared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "spice_level" varchar(10);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "portion_size" varchar(60);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "best_within_hours" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "storage_advice" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lead_time_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "max_portions_per_slot" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "photos_json" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "is_packaged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "packaged_json" jsonb;--> statement-breakpoint
ALTER TABLE "order_messages" ADD COLUMN "image_key" varchar(120);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "seller_vpa_snapshot" varchar(80);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "seller_registered_name_snapshot" varchar(160);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gst_mode_snapshot" varchar(30) DEFAULT 'unregistered' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "booked_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ready_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "on_the_way_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "at_door_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "collected_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by" varchar(10);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_method" varchar(8);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "credit_issued_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_refunded_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "scheduled_slot" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_share_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "seller_share_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "auto_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_payment_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_note" text;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD COLUMN "source" varchar(16) DEFAULT 'referral' NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD COLUMN "source_order_id" integer;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "legal_name" varchar(160);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "display_name" varchar(120);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "languages_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "food_mark" varchar(10) DEFAULT 'veg' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "cooking_days_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "cooking_hours_text" varchar(120);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "max_orders_per_day" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "min_order_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "accepts_cash" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "hygiene_declaration_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "pan_enc" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "pan_masked" varchar(12);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "pan_name_on_card" varchar(120);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "pan_verify_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_verify_status" varchar(24) DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_verified_vpa" varchar(80);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_verified_name" varchar(160);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "upi_name_match_score" integer;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "agreement_version" varchar(20);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "agreement_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "onboarding_state_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "cap_override_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "provisional_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "listings_paused_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "listings_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "founding_granted_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_annual_fee_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_granted_at" date;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "societies" ADD COLUMN "is_pilot" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "societies" ADD COLUMN "towers_json" jsonb;--> statement-breakpoint
ALTER TABLE "societies" ADD COLUMN "wa_group_name" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age18_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_recovery_hashes_json" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_window_start" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "orders_blocked_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclaimers" ADD CONSTRAINT "disclaimers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_raised_by_id_users_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_posts" ADD CONSTRAINT "menu_posts_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "society_access_requests" ADD CONSTRAINT "society_access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "society_memberships" ADD CONSTRAINT "society_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "society_memberships" ADD CONSTRAINT "society_memberships_society_id_societies_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."societies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "society_memberships" ADD CONSTRAINT "society_memberships_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upi_verifications" ADD CONSTRAINT "upi_verifications_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reads_pair_idx" ON "chat_reads" USING btree ("order_id","user_id");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "favourites_pair_idx" ON "favourites" USING btree ("user_id","seller_id");--> statement-breakpoint
CREATE INDEX "grievances_status_idx" ON "grievances" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_posts_day_idx" ON "menu_posts" USING btree ("seller_id","for_date");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "settings_history_key_idx" ON "settings_history" USING btree ("key","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "society_memberships_pair_idx" ON "society_memberships" USING btree ("user_id","society_id");--> statement-breakpoint
CREATE INDEX "strikes_user_idx" ON "strikes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "upi_verifications_seller_idx" ON "upi_verifications" USING btree ("seller_id");--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");
--> statement-breakpoint
INSERT INTO "platform_config" ("key", "value") SELECT 'gstMode', CASE WHEN "value" = 'collect_with_platform_fee' THEN 'registered_eco_9_5' ELSE 'registered_fee_only' END FROM "platform_config" WHERE "key" = 'ecoFoodGstMode' AND EXISTS (SELECT 1 FROM "platform_config" WHERE "key" = 'platformGstin' AND "value" <> '') ON CONFLICT ("key") DO NOTHING;
