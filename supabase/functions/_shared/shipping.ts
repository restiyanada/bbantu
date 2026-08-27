/**
 * Shipping-rate provider client (Milestone 3, §15) — api.co.id's "Cek Ongkir
 * v2" API (https://docs.api.co.id/api/indonesia-courier-rates).
 *
 * Kept as one small module of plain functions, not a class/interface with
 * multiple implementations — architecture.md/§15.1 ask for courier
 * integration to be "isolated behind a shipping service so another courier
 * can be added later", which this satisfies (every Edge Function that needs
 * a rate or a location lookup imports from here, never fetches api.co.id
 * directly). Building an actual pluggable-provider abstraction now, with only
 * one provider ever wired up, would be exactly the "dead flexibility"
 * CLAUDE.md warns against — add that shape later if/when a second provider
 * is actually being integrated, not speculatively now.
 *
 * Requires a `SHIPPING_API_KEY` secret (api.co.id dashboard → API key):
 *   supabase secrets set SHIPPING_API_KEY=...
 *
 * MVP scope note (confirmed): api.co.id's /courier/v2/rates returns 9
 * couriers at once, but PRD's Recommended MVP Scope (§28) names JNE only —
 * "Multiple couriers" is explicitly Future (§29). getJneRates() filters the
 * response down to courier_code === "jne" for that reason; the other 8
 * couriers' rates are simply discarded, not exposed anywhere.
 */

const BASE_URL = "https://use.api.co.id";

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

async function apiCoIdGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-api-co-id": apiKey() } });
  } catch {
    // §15.2/§23 — a courier/network failure must not take down the rest of
    // checkout. Callers turn this into "shipping is temporarily unavailable"
    // rather than a 500, and the customer can still choose pickup.
    throw new ShippingProviderError("Couldn't reach the shipping rate provider.", 503);
  }

  if (!res.ok) {
    // api.co.id's documented error shape: { message: "..." } alongside the
    // HTTP status (400 bad params, 401 bad key, 402 insufficient balance,
    // 429 rate limited). Surface the status so callers can distinguish "our
    // config is wrong" (401/402 — an admin problem) from "try again" (429/503).
    let message = `Shipping provider returned ${res.status}.`;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
      // ignore — keep the generic message
    }
    throw new ShippingProviderError(message, res.status);
  }

  return res.json() as Promise<T>;
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

export async function getProvinces(): Promise<Province[]> {
  const body = await apiCoIdGet<{ data: Province[] }>("/courier/v1/locations/provinces", {});
  return body.data;
}

export async function getCities(provinceCode: string): Promise<City[]> {
  const body = await apiCoIdGet<{ data: City[] }>("/courier/v1/locations/cities", { province: provinceCode });
  return body.data;
}

export async function getDistricts(cityCode: string): Promise<District[]> {
  const body = await apiCoIdGet<{ data: District[] }>("/courier/v1/locations/districts", { city: cityCode });
  return body.data;
}

// Assumption, flagged rather than silently baked in: no product created so
// far (Milestone 1/2) has ever set weightGrams, and the PRD doesn't specify
// a unit-economics default. 500g/item is a rough "small merch item" estimate
// (a hoodie or tote bag, matching the PRD's own MOQ example products) —
// good enough to get a real quote rather than blocking checkout entirely,
// but worth an admin actually setting real weights per product soon.
export const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

export interface WeighableItem {
  quantity: number;
  weightGrams: number | null;
}

/**
 * Total package weight in whole kilograms, rounded up — api.co.id's example
 * requests use whole-kg weights, and rounding up (never down) means the
 * quote is never an underestimate of what the courier will actually charge.
 */
export function computeWeightKg(items: WeighableItem[]): number {
  const totalGrams = items.reduce(
    (sum, item) => sum + (item.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * item.quantity,
    0
  );
  return Math.max(1, Math.ceil(totalGrams / 1000));
}

export interface JneRate {
  serviceCode: string; // e.g. "REG23", "YES23", "JTR<130" — real JNE codes vary by route/weight, not just REG/YES
  serviceName: string;
  etd: string | null; // some services (e.g. same-day/instant couriers) return no ETD at all
  price: number; // IDR, the actual chargeable amount
}

export interface RateQuoteParams {
  originDistrictCode: string;
  destinationDistrictCode: string;
  /** Whole kilograms — round up before calling, api.co.id bills per the value sent. */
  weightKg: number;
}

/**
 * Calls the paid rates endpoint (~Rp5/successful call) and returns only the
 * JNE rows — see the MVP scope note at the top of this file. Throws
 * ShippingProviderError if the call fails outright; returns an empty array
 * (not an error) if JNE simply doesn't serve this route — that's a valid,
 * displayable outcome ("no rate available for this address"), not a failure.
 */
export async function getJneRates(params: RateQuoteParams): Promise<JneRate[]> {
  const body = await apiCoIdGet<{
    data: {
      rates: Array<{
        courier_code: string;
        service_code: string;
        service_name: string;
        etd: string | null;
        price: number;
        handling_fee?: number;
      }>;
    };
  }>("/courier/v2/rates", {
    origin_district_code: params.originDistrictCode,
    destination_district_code: params.destinationDistrictCode,
    weight: String(params.weightKg),
  });

  return body.data.rates
    .filter((r) => r.courier_code === "jne")
    .map((r) => ({
      serviceCode: r.service_code,
      serviceName: r.service_name,
      etd: r.etd,
      // The real response (confirmed 2026-08-27 against a live account) has
      // no `total_price` field at all — that was a wrong assumption carried
      // over from a generic example in the provider's docs. The actual
      // chargeable amount is `price` plus `handling_fee` (insurance_fee only
      // appears when `insurance=true` is passed, which this integration
      // doesn't use, so it's never present here).
      price: r.price + (r.handling_fee ?? 0),
    }));
}
