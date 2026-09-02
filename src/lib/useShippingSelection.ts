import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface LocationOption {
  code: string;
  name: string;
}
export interface JneRateOption {
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  price: number;
}

export interface ShippingSelection {
  provinces: LocationOption[] | null;
  cities: LocationOption[] | null;
  districts: LocationOption[] | null;
  selectedProvinceCode: string;
  selectedCityCode: string;
  selectedDistrict: LocationOption | null;
  addressDetail: string;
  setAddressDetail: (value: string) => void;
  locationError: string | null;
  rates: JneRateOption[] | null;
  selectedServiceCode: string | null;
  setSelectedServiceCode: (code: string | null) => void;
  rateLoading: boolean;
  rateError: string | null;
  handleProvinceChange: (code: string) => Promise<void>;
  handleCityChange: (code: string) => Promise<void>;
  handleDistrictChange: (code: string) => void;
  handleGetRate: (items: { variantId: string; quantity: number }[]) => Promise<void>;
  /** Clears a fetched rate quote. The page calls this when the cart changes
   *  underneath it — a rate quoted for a different cart must not survive. */
  resetRates: () => void;
}

/**
 * Shipping address selection (province/city/district) and JNE rate lookup
 * for checkout. Owns the location and rate state; the cart itself stays with
 * the caller, so `handleGetRate` takes the cart lines it needs as an argument
 * instead of reading them from cart state.
 */
export function useShippingSelection(): ShippingSelection {
  const [provinces, setProvinces] = useState<LocationOption[] | null>(null);
  const [cities, setCities] = useState<LocationOption[] | null>(null);
  const [districts, setDistricts] = useState<LocationOption[] | null>(null);
  const [selectedProvinceCode, setSelectedProvinceCode] = useState("");
  const [selectedCityCode, setSelectedCityCode] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState<LocationOption | null>(null);
  const [addressDetail, setAddressDetail] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);

  const [rates, setRates] = useState<JneRateOption[] | null>(null);
  const [selectedServiceCode, setSelectedServiceCode] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProvinces() {
      const { data, error } = await supabase.functions.invoke("shipping-locations", { body: { level: "provinces" } });
      if (cancelled) return;
      if (error || !data) {
        setLocationError("Couldn't load shipping locations. Shipping may be unavailable right now.");
        return;
      }
      setProvinces(data.items as LocationOption[]);
    }
    void loadProvinces();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleProvinceChange(code: string) {
    setSelectedProvinceCode(code);
    setSelectedCityCode("");
    setSelectedDistrict(null);
    setCities(null);
    setDistricts(null);
    setRates(null);
    setSelectedServiceCode(null);
    if (!code) return;

    const { data, error } = await supabase.functions.invoke("shipping-locations", {
      body: { level: "cities", provinceCode: code },
    });
    if (error || !data) {
      setLocationError("Couldn't load cities for that province.");
      return;
    }
    setLocationError(null);
    setCities(data.items as LocationOption[]);
  }

  async function handleCityChange(code: string) {
    setSelectedCityCode(code);
    setSelectedDistrict(null);
    setDistricts(null);
    setRates(null);
    setSelectedServiceCode(null);
    if (!code) return;

    const { data, error } = await supabase.functions.invoke("shipping-locations", {
      body: { level: "districts", cityCode: code },
    });
    if (error || !data) {
      setLocationError("Couldn't load districts for that city.");
      return;
    }
    setLocationError(null);
    setDistricts(data.items as LocationOption[]);
  }

  function handleDistrictChange(code: string) {
    const district = districts?.find((d) => d.code === code) ?? null;
    setSelectedDistrict(district);
    setRates(null);
    setSelectedServiceCode(null);
  }

  async function handleGetRate(items: { variantId: string; quantity: number }[]) {
    if (!selectedDistrict) return;
    if (items.length === 0) {
      setRateError("Add at least one item before getting a shipping rate.");
      return;
    }

    setRateLoading(true);
    setRateError(null);
    setRates(null);
    setSelectedServiceCode(null);

    const { data, error } = await supabase.functions.invoke("shipping-rates", {
      body: { destinationDistrictCode: selectedDistrict.code, items },
    });

    setRateLoading(false);

    if (error || !data) {
      setRateError(
        (data as { error?: string } | null)?.error ?? "Couldn't get a shipping rate right now. Please try again."
      );
      return;
    }

    const fetchedRates = data.rates as JneRateOption[];
    if (fetchedRates.length === 0) {
      setRateError("JNE doesn't appear to deliver to that address — please double-check the district, or choose pickup instead.");
      return;
    }

    setRates(fetchedRates);
    setSelectedServiceCode(fetchedRates[0].serviceCode);
  }

  const resetRates = useCallback(() => {
    setRates(null);
    setSelectedServiceCode(null);
    setRateError(null);
  }, []);

  return {
    provinces,
    cities,
    districts,
    selectedProvinceCode,
    selectedCityCode,
    selectedDistrict,
    addressDetail,
    setAddressDetail,
    locationError,
    rates,
    selectedServiceCode,
    setSelectedServiceCode,
    rateLoading,
    rateError,
    handleProvinceChange,
    handleCityChange,
    handleDistrictChange,
    handleGetRate,
    resetRates,
  };
}
