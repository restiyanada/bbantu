-- Hand-written, not journaled — same reasoning as 0004/0006/0015 (pg_cron
-- schedule change, no schema.ts change). Security-review followup: migration
-- 0008 planned this cleanup and left the exact SQL in a comment, but the job
-- was never actually scheduled — rate_limit_attempts has been growing
-- unbounded since (rows are only meaningful for RATE_LIMIT_WINDOW_MS, 60s;
-- everything older is dead weight, per lib/rate-limit.ts).
--
-- Daily is plenty — nothing reads rows older than a minute, so there's no
-- latency requirement pushing this tighter, same reasoning as
-- cleanup-payment-proofs' schedule (0006).
--
-- Safe to re-run: cron.schedule() updates the existing job by name rather
-- than erroring on a duplicate.
--
-- Verify:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'purge-rate-limit-attempts';
--   -- 1 row, schedule = '0 4 * * *'

select cron.schedule(
  'purge-rate-limit-attempts',
  '0 4 * * *',
  $$DELETE FROM rate_limit_attempts WHERE created_at < now() - interval '1 day'$$
);
