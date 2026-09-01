CREATE TYPE "public"."complaint_category" AS ENUM('quality', 'wrong_item', 'hygiene', 'not_received');--> statement-breakpoint
CREATE TYPE "public"."complaint_outcome" AS ENUM('full_refund', 'partial_refund', 'warning', 'seller_paused', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "complaints" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"buyer_id" integer NOT NULL,
	"seller_id" integer,
	"category" "complaint_category" NOT NULL,
	"description" text NOT NULL,
	"photo_url" text,
	"status" "complaint_status" DEFAULT 'open' NOT NULL,
	"outcome" "complaint_outcome",
	"refund_in_paise" integer DEFAULT 0 NOT NULL,
	"resolution_note" text,
	"resolved_by_admin_id" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_deducted_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "refund_deduction_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "seller_reply_text" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "seller_replied_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "kitchen_photos_json" jsonb;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "kitchen_video_url" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "cooking_since_year" integer;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "cuisines_json" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "complaints" ADD CONSTRAINT "complaints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "complaints" ADD CONSTRAINT "complaints_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "complaints" ADD CONSTRAINT "complaints_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_admin_id_users_id_fk" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
