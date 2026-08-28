-- Milestone 6: numbered 0005 (not 0004) even though the journal's previous
-- entry is 0003 — 0004_milestone5_email_worker_schedule.sql already exists
-- on disk as a hand-written, non-journal-tracked file (pg_cron setup, no
-- schema.ts changes for drizzle-kit to have generated it from). Skipping to
-- 0005 avoids two unrelated files both prefixed "0004_".
CREATE TABLE "access_recovery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_address" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_recovery_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfilled_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "proof_deleted_at" timestamp;