CREATE TABLE "visit_counters" (
	"day" varchar(10) NOT NULL,
	"society_id" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "visit_counters_pk" ON "visit_counters" USING btree ("day","society_id");