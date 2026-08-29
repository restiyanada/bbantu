import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { productVariants, shippingSettings } from "../../../db/schema.ts";
import { getJneRates, computeWeightKg, ShippingProviderError } from "../_shared/shipping.ts";

const rateRequestSchema = z.object({
  destinationDistrictCode: z.string().trim().min(1, "Destination district is required."),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, "At least one item is required."),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof rateRequestSchema>;
  try {
    input = rateRequestSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    // Unauthenticated, and every call spends a request against JNE's paid API
    // — the limit is what stops a scripted loop burning the quota. 30/min is
    // above what re-quoting a few addresses at checkout needs.
    await enforceRateLimit(req, "shipping-rates", 30);

    const [origin] = await db.select().from(shippingSettings).limit(1);
    if (!origin) {
      throw new HttpError(503, "Shipping isn't configured yet — please contact us or choose pickup instead.");
    }

    const variantIds = [...new Set(input.items.map((i) => i.variantId))];
    const variants = await db.select().from(productVariants).where(inArray(productVariants.id, variantIds));
    if (variants.length !== variantIds.length) {
      throw new HttpError(400, "One or more items reference a product variant that doesn't exist.");
    }
    const weightByVariant = new Map(variants.map((v) => [v.id, v.weightGrams]));

    const weightKg = computeWeightKg(
      input.items.map((item) => ({ quantity: item.quantity, weightGrams: weightByVariant.get(item.variantId) ?? null }))
    );

    const rates = await getJneRates({
      originDistrictCode: origin.originDistrictCode,
      destinationDistrictCode: input.destinationDistrictCode,
      weightKg,
    });

    return json({ rates, weightKg, originDistrictName: origin.originDistrictName });
  } catch (err) {
    if (err instanceof ShippingProviderError) {
      return errorResponse(new HttpError(err.status >= 500 ? 503 : 502, err.message), "");
    }
    return errorResponse(err, "Unexpected error getting shipping rates.");
  }
});
