CREATE TABLE "disclaimer_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"disclaimer_id" varchar(40) NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"changed_by" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"material" boolean DEFAULT false NOT NULL,
	"change_summary" text,
	"effective_date" varchar(10),
	"published_by" integer,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "review_status" varchar(10) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "effective_date" varchar(10);--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "change_summary" text;--> statement-breakpoint
ALTER TABLE "disclaimer_versions" ADD CONSTRAINT "disclaimer_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclaimer_versions_uq" ON "disclaimer_versions" USING btree ("disclaimer_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_document_versions_uq" ON "legal_document_versions" USING btree ("slug","version");--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;