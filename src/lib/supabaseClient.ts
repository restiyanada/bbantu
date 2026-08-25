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

/**
 * A client scoped to one guest order's access token (§16, §27). The token is
 * sent as a custom header on every request; the RLS policies in db/schema.ts
 * (e.g. "guest_can_read_own_order") match it against orders.access_token —
 * that match, not the client's own .eq() filters, is what actually restricts
 * access to this one order.
 *
 * Create a fresh instance per token — don't reuse the module-level `supabase`
 * singleton above for guest order reads, since it has no token to send.
 */
export function createGuestOrderClient(accessToken: string) {
  return createClient(url, publishableKey, {
    global: {
      headers: { "x-order-access-token": accessToken },
    },
  });
}
