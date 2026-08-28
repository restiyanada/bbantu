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
