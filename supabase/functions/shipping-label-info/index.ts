import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { shippingSettings } from "../../../db/schema.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await requireAdmin(req, "canManageShipping");

    const [settings] = await db
      .select({
        originDistrictName: shippingSettings.originDistrictName,
        originAddress: shippingSettings.originAddress,
        senderName: shippingSettings.senderName,
        senderPhone: shippingSettings.senderPhone,
      })
      .from(shippingSettings)
      .limit(1);

    return json({ settings: settings ?? null });
  } catch (err) {
    return errorResponse(err, "Unexpected error loading shipping settings.");
  }
});
