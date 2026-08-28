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
      price: r.price + (r.handling_fee ?? 0),
    }));
}
