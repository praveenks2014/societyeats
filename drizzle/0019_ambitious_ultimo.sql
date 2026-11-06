ALTER TABLE "fssai_applications" ADD COLUMN "interruption_at" timestamp;--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "interruption_note" text;--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "changes_requested_note" text;--> statement-breakpoint
ALTER TABLE "fssai_applications" ADD COLUMN "changes_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_blocked_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "fssai_blocked_at" timestamp;