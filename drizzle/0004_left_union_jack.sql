CREATE TYPE "public"."fssai_filing_mode" AS ENUM('facilitator', 'self');--> statement-breakpoint
ALTER TABLE "fssai_applications" ALTER COLUMN "license_type" SET DEFAULT 'registration';--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "filing_mode" "fssai_filing_mode" DEFAULT 'facilitator' NOT NULL;--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "facilitation_cost_in_paise" integer DEFAULT 200000 NOT NULL;--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "sponsored_by_platform" boolean DEFAULT true NOT NULL;