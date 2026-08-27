/**
 * POST /shipping-locations — province/city/district lookups for the
 * shipping address form (§15.2 needs a district code, not a free-text
 * address, as input to a rate lookup).
 *
 * These three api.co.id endpoints are free (no per-call charge, per their
 * pricing page) — but the API key still can't go in the browser bundle, so
 * this is a thin proxy purely to keep SHIPPING_API_KEY server-side. No DB
 * access at all, unlike every other function in this project — there's
 * nothing here that's a business-rule computation, just a secret-holding
 * relay (architecture.md's Edge-Function rule of thumb is about bypassing
 * RLS / trusting business data, not about proxying a third-party API key,
 * but the API key still can't be exposed either way).
 *
 * { level: "provinces" }
 * { level: "cities", provinceCode }
 * { level: "districts", cityCode }
 */

import { z } from "zod";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse, HttpError } from "../_shared/http.ts";
import { getProvinces, getCities, getDistricts, ShippingProviderError } from "../_shared/shipping.ts";

const locationsSchema = z.union([
  z.object({ level: z.literal("provinces") }),
  z.object({ level: z.literal("cities"), provinceCode: z.string().min(1) }),
  z.object({ level: z.literal("districts"), cityCode: z.string().min(1) }),
]);

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof locationsSchema>;
  try {
    input = locationsSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    if (input.level === "provinces") {
      return json({ items: await getProvinces() });
    }
    if (input.level === "cities") {
      return json({ items: await getCities(input.provinceCode) });
    }
    return json({ items: await getDistricts(input.cityCode) });
  } catch (err) {
    if (err instanceof ShippingProviderError) {
      return errorResponse(new HttpError(err.status >= 500 ? 503 : 502, err.message), "");
    }
    return errorResponse(err, "Unexpected error looking up shipping locations.");
  }
});
