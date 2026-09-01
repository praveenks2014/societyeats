CREATE TYPE "public"."fulfillment_type" AS ENUM('self_pickup', 'seller_delivery', 'platform_delivery');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_type" "fulfillment_type" DEFAULT 'self_pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gst_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "offers_self_pickup" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "offers_seller_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "seller_delivery_fee_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "seller_delivery_radius_km" double precision DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "pickup_instructions" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "max_orders_per_slot" integer DEFAULT 8 NOT NULL;