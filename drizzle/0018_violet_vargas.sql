CREATE TABLE "invoice_counters" (
	"fy" varchar(7) PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_number" varchar(24);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoice_number_unique" UNIQUE("invoice_number");