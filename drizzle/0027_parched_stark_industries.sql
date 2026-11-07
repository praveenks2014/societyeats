CREATE TABLE "bulk_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"buyer_id" integer NOT NULL,
	"seller_id" integer NOT NULL,
	"description" text NOT NULL,
	"portions" integer NOT NULL,
	"for_date" varchar(10) NOT NULL,
	"status" varchar(12) DEFAULT 'requested' NOT NULL,
	"quote_items_json" jsonb,
	"quote_note" text,
	"order_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"quoted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"starts_on" varchar(10) NOT NULL,
	"ends_on" varchar(10) NOT NULL,
	"seller_ids_json" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "featured_placements" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"society_id" integer NOT NULL,
	"starts_on" varchar(10) NOT NULL,
	"ends_on" varchar(10) NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_subs" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"buyer_id" integer NOT NULL,
	"anchor_order_id" integer,
	"week_start" varchar(10) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"days" jsonb NOT NULL,
	"slot" varchar(10) NOT NULL,
	"rotation_json" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plus_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"price_paise" integer NOT NULL,
	"gst_paise" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending_payment' NOT NULL,
	"razorpay_order_id" varchar(80),
	"razorpay_payment_id" varchar(80),
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "meal_plan_sub_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "plus_discount_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bulk_requests" ADD CONSTRAINT "bulk_requests_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_requests" ADD CONSTRAINT "bulk_requests_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_placements" ADD CONSTRAINT "featured_placements_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_placements" ADD CONSTRAINT "featured_placements_society_id_societies_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."societies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_placements" ADD CONSTRAINT "featured_placements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_subs" ADD CONSTRAINT "meal_plan_subs_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_subs" ADD CONSTRAINT "meal_plan_subs_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plus_memberships" ADD CONSTRAINT "plus_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;