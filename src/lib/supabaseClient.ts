import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env.local"
  );
}

// This key is safe to expose in the browser bundle by design (§27 — public
// storefront access). It can only do what Row Level Security policies allow.
// Anything that needs to bypass RLS (payment verification, status changes,
// inventory allocation) must go through a Supabase Edge Function instead —
// never a direct table write from here.
export const supabase = createClient(url, publishableKey);
