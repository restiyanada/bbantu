// Supabase Edge Function — health check, mirrors the old Next.js /api/health route.
// Local dev: supabase functions serve health
// Deploy:    supabase functions deploy health
//
// This runs server-side (Deno), using the service role key, so it can bypass
// RLS. This is the pattern for anything the browser must not be trusted to
// do directly: payment verification, order status transitions, inventory
// allocation.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabase.from("customers").select("id").limit(1);
    if (error) throw error;

    return new Response(JSON.stringify({ status: "ok", db: "connected" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
