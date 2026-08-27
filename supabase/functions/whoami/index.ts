/**
 * POST /whoami — returns the logged-in admin's own identity + §18.4
 * permission flags.
 *
 * The frontend calls this once after login (and keeps the result in memory
 * for the session) so it can disable — not hide — actions the current
 * admin isn't allowed to take, matching §18.4: "Actions the admin lacks
 * permission for are visible but disabled, never hidden." Requires no
 * specific permission beyond being a real admin at all — same reasoning as
 * list-orders (§18.4: "the dashboard itself is read-only for everyone
 * regardless of permissions").
 */

import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const admin = await requireAdmin(req, null);
    return json(admin);
  } catch (err) {
    return errorResponse(err, "Unexpected error fetching admin profile.");
  }
});
