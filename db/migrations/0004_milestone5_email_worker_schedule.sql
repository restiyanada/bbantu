-- Milestone 5 (§24.2) — schedules supabase/functions/send-queued-emails to
-- run automatically every 5 minutes via pg_cron + pg_net.
--
-- This file deliberately contains no real secret. The Authorization header
-- below is pulled from Supabase Vault at run time (vault.decrypted_secrets),
-- not hardcoded here — a real service-role key committed to a public git
-- history would defeat the point of having one. Vault secret creation is a
-- one-time manual step, not part of this migration — see the Milestone 5
-- setup notes for the exact SQL to run once, by hand, in the SQL editor.
--
-- Safe to re-run: cron.schedule() updates the existing job by name rather
-- than erroring on a duplicate.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-queued-emails',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://lhvxjgbjjamwatsmxiyc.supabase.co/functions/v1/send-queued-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
