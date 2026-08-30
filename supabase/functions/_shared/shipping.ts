import { z } from "zod";

const BASE_URL = "https://use.api.co.id";
const REQUEST_TIMEOUT_MS = 8000;

function apiKey(): string {
  const key = Deno.env.get("SHIPPING_API_KEY");
  if (!key) {
    throw new Error("SHIPPING_API_KEY must be set as a Supabase Edge Function secret.");
  }
  return key;
}

export class ShippingProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ShippingProviderError";
  }
}

// The response body is cast with `as Promise<T>` nowhere in this file — every
// caller passes a zod schema and gets back parsed, validated data. This
// matters most for getJneRates: `price` flows directly into
// create-order's payment-amount math, so a malformed or unexpected shape
// from this third-party API should fail loudly here rather than silently
// becoming a wrong charge.
async function apiCoIdGet<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-api-co-id": apiKey() }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    // Covers both a network failure and a timeout — the customer waiting on
    // a shipping quote at checkout shouldn't wait indefinitely for either.
    throw new ShippingProviderError("Couldn't reach the shipping rate provider.", 503);
  }

  if (!res.ok) {
    let message = `Shipping provider returned ${res.status}.`;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
    }
    throw new ShippingProviderError(message, res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ShippingProviderError("Shipping provider returned an invalid response.", 502);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ShippingProviderError("Shipping provider returned an unexpected response shape.", 502);
  }
  return parsed.data;
}

export interface Province {
  code: string;
  name: string;
}
export interface City {
  code: string;
  name: string;
}
export interface District {
  code: string;
  name: string;
}

const locationSchema = z.object({ code: z.string(), name: z.string() });
const provincesResponseSchema = z.object({ data: z.array(locationSchema) });
const citiesResponseSchema = z.object({ data: z.array(locationSchema) });
const districtsResponseSchema = z.object({ data: z.array(locationSchema) });

export async function getProvinces(): Promise<Province[]> {
  const body = await apiCoIdGet("/courier/v1/locations/provinces", {}, provincesResponseSchema);
  return body.data;
}

export async function getCities(provinceCode: string): Promise<City[]> {
  const body = await apiCoIdGet("/courier/v1/locations/cities", { province: provinceCode }, citiesResponseSchema);
  return body.data;
}

export async function getDistricts(cityCode: string): Promise<District[]> {
  const body = await apiCoIdGet("/courier/v1/locations/districts", { city: cityCode }, districtsResponseSchema);
  return body.data;
}

export const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

export interface WeighableItem {
  quantity: number;
  weightGrams: number | null;
}

export function computeWeightKg(items: WeighableItem[]): number {
  const totalGrams = items.reduce(
    (sum, item) => sum + (item.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * item.quantity,
    0
  );
  return Math.max(1, Math.ceil(totalGrams / 1000));
}

export interface JneRate {
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  price: number;
}

export interface RateQuoteParams {
  originDistrictCode: string;
  destinationDistrictCode: string;
  weightKg: number;
}

const jneRateSchema = z.object({
  courier_code: z.string(),
  service_code: z.string(),
  service_name: z.string(),
  etd: z.string().nullable(),
  price: z.number().nonnegative(),
  handling_fee: z.number().nonnegative().optional(),
});
const ratesResponseSchema = z.object({ data: z.object({ rates: z.array(jneRateSchema) }) });

export async function getJneRates(params: RateQuoteParams): Promise<JneRate[]> {
  const body = await apiCoIdGet(
    "/courier/v2/rates",
    {
      origin_district_code: params.originDistrictCode,
      destination_district_code: params.destinationDistrictCode,
      weight: String(params.weightKg),
    },
    ratesResponseSchema
  );

  return body.data.rates
    .filter((r) => r.courier_code === "jne")
    .map((r) => ({
      serviceCode: r.service_code,
      serviceName: r.service_name,
      etd: r.etd,
      price: r.price + (r.handling_fee ?? 0),
    }));
}
