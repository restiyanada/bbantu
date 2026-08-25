/**
 * Standard CORS handling for Edge Functions invoked from the browser SPA.
 * Without this, supabase-js's functions.invoke() calls fail preflight from
 * the browser even though they'd work fine from curl/Postman.
 *
 * TODO: scope Access-Control-Allow-Origin to the actual frontend origin once
 * it's deployed, instead of "*". Fine for local/MVP development.
 */

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Call at the top of every handler. Returns a Response for OPTIONS preflight, or null to continue. */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
