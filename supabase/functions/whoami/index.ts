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
