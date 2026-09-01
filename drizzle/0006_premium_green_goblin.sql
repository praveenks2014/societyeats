CREATE TYPE "public"."referral_credit_status" AS ENUM('available', 'applied');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"buyer_id" integer NOT NULL,
	"referred_user_id" integer NOT NULL,
	"referred_order_id" integer NOT NULL,
	"amount_in_paise" integer NOT NULL,
	"status" "referral_credit_status" DEFAULT 'available' NOT NULL,
	"applied_to_order_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "referral_credit_applied_in_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "societies" ADD COLUMN "invite_code" varchar(24);--> statement-breakpoint
ALTER TABLE "societies" ADD COLUMN "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar(12);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_referred_order_id_orders_id_fk" FOREIGN KEY ("referred_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_applied_to_order_id_orders_id_fk" FOREIGN KEY ("applied_to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "societies" ADD CONSTRAINT "societies_invite_code_unique" UNIQUE("invite_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");