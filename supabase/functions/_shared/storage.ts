import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available.");
}

const storageClient = createClient(supabaseUrl, serviceRoleKey);

export async function getSignedProofUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await storageClient.storage.from("payment-proofs").createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteProofObject(path: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await storageClient.storage.from("payment-proofs").remove([path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}
