CREATE TYPE "public"."fssai_verified_by" AS ENUM('api', 'admin');--> statement-breakpoint
ALTER TYPE "public"."fssai_app_status" ADD VALUE 'inspection_ordered';--> statement-breakpoint
ALTER TYPE "public"."fssai_app_status" ADD VALUE 'inadequacy_notice';--> statement-breakpoint
ALTER TYPE "public"."fssai_status" ADD VALUE 'awaiting_admin_check';--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "filed_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_certificate_url" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_verified_by" "fssai_verified_by";--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_licensee_name" varchar(160);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_licensee_address" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_verification_timeline_json" jsonb;