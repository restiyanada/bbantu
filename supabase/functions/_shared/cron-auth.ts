// Gates the two cron-only functions (send-queued-emails,
// cleanup-payment-proofs). Both are listed with the platform default
// (verify_jwt = true) in config.toml, but that check only proves the caller
// presents *some* validly-signed project JWT — the anon key satisfies it,
// and the anon key is public by design (it ships in the frontend bundle).
// So verify_jwt = true is not a real boundary for these two; this header,
// known only to the pg_cron job that's supposed to call them, is.
const cronSecret = Deno.env.get("CRON_SECRET");
if (!cronSecret) {
  throw new Error("CRON_SECRET must be set as a Supabase Edge Function secret.");
}

export function isAuthorizedCronCaller(req: Request): boolean {
  return req.headers.get("x-cron-secret") === cronSecret;
}
