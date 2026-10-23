ALTER TYPE "public"."order_status" ADD VALUE 'fee_paid' BEFORE 'paid';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'awaiting_kitchen_payment_confirmation' BEFORE 'paid';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'expired' BEFORE 'paid';--> statement-breakpoint
ALTER TYPE "public"."referral_credit_status" ADD VALUE 'reserved' BEFORE 'applied';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kitchen_refunds_due" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"seller_id" integer NOT NULL,
	"amount_in_paise" integer NOT NULL,
	"reason" varchar(40) NOT NULL,
	"status" varchar(12) DEFAULT 'due' NOT NULL,
	"refund_utr" varchar(40),
	"refunded_at" timestamp,
	"last_chased_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"order_id" integer,
	"subscription_id" integer,
	"razorpay_payment_id" varchar(80),
	"razorpay_refund_id" varchar(80),
	"amount_in_paise" integer NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"reason" text,
	"initiated_by" varchar(16) DEFAULT 'system' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" varchar(120) PRIMARY KEY NOT NULL,
	"type" varchar(60) NOT NULL,
	"outcome" varchar(40),
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "raised_by" varchar(10) DEFAULT 'buyer' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "platform_fee_refund_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "food_refund_due_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_total_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "online_charge_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_before_credit_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee_gst_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_bps_snapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_min_snapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_max_snapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_gst_bps_snapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "eco_mode_snapshot" varchar(30) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "eco_bps_snapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_status" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_utr" varchar(40);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "food_payment_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "kitchen_payment_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "accept_by" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_reserved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" varchar(12) DEFAULT 'order_fee' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "tower" varchar(40);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kitchen_refunds_due" ADD CONSTRAINT "kitchen_refunds_due_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kitchen_refunds_due" ADD CONSTRAINT "kitchen_refunds_due_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refunds" ADD CONSTRAINT "refunds_subscription_id_kitchen_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."kitchen_subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "krd_seller_idx" ON "kitchen_refunds_due" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_rzp_idx" ON "refunds" USING btree ("razorpay_refund_id");--> statement-breakpoint
UPDATE "orders" SET "completed_at" = "updated_at" WHERE "status" IN ('delivered', 'picked_up') AND "completed_at" IS NULL;
--> statement-breakpoint
UPDATE "seller_profiles" SET "listing_state" = 'approved' WHERE "is_approved" = true;
--> statement-breakpoint
UPDATE "orders" SET "food_total_in_paise" = "subtotal_in_paise" + "delivery_fee_in_paise", "online_charge_in_paise" = "total_in_paise" WHERE "food_total_in_paise" = 0;
--> statement-breakpoint
UPDATE "payments" SET "amount_in_paise" = COALESCE((SELECT o."total_in_paise" FROM "orders" o WHERE o."id" = "payments"."order_id"), 0), "kind" = 'order_full' WHERE "amount_in_paise" = 0;
