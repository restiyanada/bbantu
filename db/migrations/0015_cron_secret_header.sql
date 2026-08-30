-- Hand-written, not journaled — same reasoning as 0004/0006 (pg_cron
-- schedule changes, no schema.ts change). Security-review followup: both
-- send-queued-emails and cleanup-payment-proofs are listed with the
-- platform default (verify_jwt = true) in supabase/config.toml rather than
-- verify_jwt = false, on the theory that the platform's own JWT check was
-- the boundary keeping them cron-only. It isn't — verify_jwt = true only
-- proves the caller presents *some* validly-signed project JWT, and the
-- anon key (public, shipped in the frontend bundle) is one. Anyone who
-- extracts it from the built JS can already call either function directly.
--
-- Fix is a shared secret only the real pg_cron job knows, checked inside
-- each function (see supabase/functions/_shared/cron-auth.ts) — not a
-- platform-level control, so it doesn't care what verify_jwt is set to.
--
-- One-time manual step, run ONCE by hand in the SQL editor before this
-- migration (same reasoning as edge_function_service_role_key in 0004: a
-- real secret value doesn't belong committed to git history):
--
--   SELECT vault.create_secret('<the CRON_SECRET value>', 'cron_invoke_secret');
--
-- Use the same value as the CRON_SECRET Edge Function secret
-- (`supabase secrets set CRON_SECRET=...`) — the header value pulled from
-- Vault below has to match what each function compares it against.
--
-- Safe to re-run: cron.schedule() updates the existing job by name rather
-- than erroring on a duplicate.
--
-- Verify:
--   SELECT jobname, command FROM cron.job WHERE jobname IN
--     ('send-queued-emails', 'cleanup-payment-proofs');
--   -- both commands' headers must now include x-cron-secret
--
--   curl -X POST https://lhvxjgbjjamwatsmxiyc.supabase.co/functions/v1/send-queued-emails \
--     -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d '{}'
--   -- must now return 401 {"error":"Not authorized."} — previously it ran

select cron.schedule(
  'send-queued-emails',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://lhvxjgbjjamwatsmxiyc.supabase.co/functions/v1/send-queued-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_invoke_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'cleanup-payment-proofs',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://lhvxjgbjjamwatsmxiyc.supabase.co/functions/v1/cleanup-payment-proofs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_invoke_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
