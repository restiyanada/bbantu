import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "./fetchWithTimeout";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env.local"
  );
}

// Every network call this app makes — auth, PostgREST reads, Edge Function
// invokes — goes through this one client. A stalled mobile connection used
// to leave the caller waiting forever; this bounds all of it the same way
// supabase/functions/_shared/fetch-with-timeout.ts bounds the server side.
export const supabase = createClient(url, publishableKey, {
  global: { fetch: fetchWithTimeout(15000) },
});
