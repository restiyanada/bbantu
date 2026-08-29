-- Two changes from the pre-deploy security review.
--
-- 1. RLS on three tables that never had it. `payment_settings`,
--    `shipping_settings` and `inventory_transactions` were created without RLS
--    and never picked it up, while every other table got it in Milestone 4.
--
--    `payment_settings` is the serious one: it holds the bank account number
--    customers are told to transfer to at checkout, and it is read straight
--    from the browser with the anon key (src/pages/HomePage.tsx). RLS was the
--    only thing separating "anon can read this row" from "anon can rewrite
--    this row" — without it, anyone reaching the REST endpoint could swap in
--    their own account number and quietly collect every customer's payment.
--    No error, no audit trail; checkout would just start printing the
--    attacker's account. It keeps a public SELECT policy (checkout needs to
--    display it) and gains no write policy, which makes it service-role-only
--    to write.
--
--    `shipping_settings` and `inventory_transactions` get RLS with no policies
--    at all — deny-all, same shape as `audit_logs`. Neither is touched from
--    the browser; Edge Functions reach them over the service-role connection,
--    which bypasses RLS.
--
-- 2. `rate_limit_attempts` — backs §16.1/§19's per-IP limits, now applied to
--    create-order, shipping-rates, shipping-locations and recover-order-access
--    (see supabase/functions/_shared/rate-limit.ts). The `endpoint` column
--    keeps each function's budget separate. Supersedes
--    `access_recovery_attempts`, which is left in place for now rather than
--    dropped in the same change that replaced it.
--
-- ⚠️ APPLY WITH `drizzle-kit migrate`, OR BY HAND IN THE SQL EDITOR — NOT
-- `drizzle-kit push`.
--
-- This is not stylistic. ARCHITECTURE.md documents `push` silently dropping
-- RLS policy conditions (drizzle-orm#3504 / #4078). It has already bitten this
-- project twice; the second time it took down the storefront for anonymous
-- visitors and permanently disabled "Create product", and took days to isolate
-- because a NULL `qual` does not error — it just denies, silently. Pushed
-- here, the `anyone_can_read_payment_settings` policy below would land with a
-- NULL condition and checkout would stop showing bank details.
--
-- After applying, verify. Empty result is what you want:
--
--   SELECT tablename, policyname, qual FROM pg_policies WHERE qual IS NULL;
--
-- And confirm RLS is actually on:
--
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename IN ('payment_settings','shipping_settings',
--                       'inventory_transactions','rate_limit_attempts');
--
-- Housekeeping: rate_limit_attempts rows are only meaningful for 60s. They are
-- harmless but grow forever, so add this alongside the existing pg_cron jobs
-- (0004/0006) when convenient:
--
--   SELECT cron.schedule('purge-rate-limit-attempts', '0 4 * * *',
--     $$DELETE FROM rate_limit_attempts WHERE created_at < now() - interval '1 day'$$);

CREATE TABLE "rate_limit_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"ip_address" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipping_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rate_limit_attempts_lookup_idx" ON "rate_limit_attempts" USING btree ("endpoint","ip_address","created_at");--> statement-breakpoint
CREATE POLICY "anyone_can_read_payment_settings" ON "payment_settings" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);