-- Milestone 6 (§8/§19) — schedules
-- supabase/functions/cleanup-payment-proofs to run automatically once a
-- day via pg_cron + pg_net. Same pattern as
-- 0004_milestone5_email_worker_schedule.sql for send-queued-emails —
-- hand-written, not drizzle-generated (no schema.ts change here), and
-- deliberately not added to meta/_journal.json for the same reason 0004
-- wasn't: `db:push` diffs schema.ts directly and never replays this file,
-- so it's documentation of a one-time manual step, run once by hand in the
-- SQL editor after the pg_cron/pg_net extensions and the
-- edge_function_service_role_key Vault secret already exist (both already
-- set up for the email worker — nothing new to create here).
--
-- Daily, not every 5 minutes like the email worker: this job has no
-- user-facing latency requirement (a proof sitting an extra few hours past
-- its 30-day mark is not a problem the way a delayed BALANCE_DUE email
-- would be), so a lighter schedule is enough.
--
-- Safe to re-run: cron.schedule() updates the existing job by name rather
-- than erroring on a duplicate.

select cron.schedule(
  'cleanup-payment-proofs',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://lhvxjgbjjamwatsmxiyc.supabase.co/functions/v1/cleanup-payment-proofs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
