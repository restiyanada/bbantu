import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available.");
}

const storageClient = createClient(supabaseUrl, serviceRoleKey);

export async function getSignedProofUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await storageClient.storage.from("payment-proofs").createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    // Swallowing this used to make every failure — a wrong path, a missing
    // bucket, a real Storage outage — look identical to "the file was cleaned
    // up after 30 days" in the admin UI. Logging it is the only way to tell
    // those apart from the function logs.
    console.error(`getSignedProofUrl failed for path "${path}":`, error?.message ?? "no data returned");
    return null;
  }
  return data.signedUrl;
}

export async function deleteProofObject(path: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await storageClient.storage.from("payment-proofs").remove([path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}
