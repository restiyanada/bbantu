import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env.local"
  );
}

export const supabase = createClient(url, publishableKey);

export function createGuestOrderClient(accessToken: string) {
  return createClient(url, publishableKey, {
    global: {
      headers: { "x-order-access-token": accessToken },
    },
    // This is a stateless, read-only lookup for a guest who never logs in —
    // it has no session to persist. Without a storageKey of its own it
    // defaults to the SAME key as the module-level `supabase` client above
    // (both point at the same project), and GoTrue warns "Multiple
    // GoTrueClient instances detected" purely on that — the check is on
    // storageKey alone, before persistSession is even considered. Worse than
    // the console noise: two clients sharing a key both think they own it,
    // which can stomp a real admin session if a link is opened in the same
    // tab an admin is signed into.
    auth: {
      storageKey: "sb-guest-order-access",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
