/**
 * POST /shipping-label-info — the business's own "from" details for
 * printing shipping labels (§3/§4 of the UI feedback batch): sender name,
 * phone, and origin city/address.
 *
 * shipping_settings has no RLS (db/schema.ts — "the browser never reads
 * this table directly anyway"), so this mirrors list-orders: a small
 * service-role Edge Function is the only way the admin screen can read it.
 * Gated on canManageShipping, same permission record-tracking and the
 * shipping half of prepare-pickup already require — printing a label is
 * part of the same shipping workflow.
 */

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
