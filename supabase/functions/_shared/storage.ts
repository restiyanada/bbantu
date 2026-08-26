import { createClient } from "@supabase/supabase-js";

// Standard Supabase platform secrets, auto-injected into every deployed
// Edge Function — unlike DATABASE_URL, these don't need `supabase secrets
// set`.
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available.");
}

const storageClient = createClient(supabaseUrl, serviceRoleKey);

/**
 * Short-lived signed URL for a private payment-proof object, so admin can
 * actually view it before verifying/rejecting a payment. The bucket has no
 * public or anon read policy at all (supabase/storage_setup.sql) — a signed
 * URL (or the service-role connection directly) is the only way to view one.
 */
export async function getSignedProofUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await storageClient.storage.from("payment-proofs").createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
