// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { functions: { invoke } },
}));

import { useShippingSelection } from "./useShippingSelection";

const provinces = [{ code: "P1", name: "Province 1" }];
const cities = [{ code: "C1", name: "City 1" }];
const districts = [{ code: "D1", name: "District 1" }];
const rates = [{ serviceCode: "REG", serviceName: "Reguler", etd: "1-2", price: 15000 }];

function mockInvoke() {
  invoke.mockImplementation(async (name: string, opts: { body: Record<string, unknown> }) => {
    if (name === "shipping-locations") {
      if (opts.body.level === "provinces") return { data: { items: provinces }, error: null };
      if (opts.body.level === "cities") return { data: { items: cities }, error: null };
      if (opts.body.level === "districts") return { data: { items: districts }, error: null };
    }
    if (name === "shipping-rates") {
      return { data: { rates }, error: null };
    }
    return { data: null, error: { message: "unexpected call" } };
  });
}

beforeEach(() => {
  mockInvoke();
});
afterEach(() => vi.restoreAllMocks());

/** Drives the hook through province -> city -> district selection. */
async function selectDistrict(result: { current: ReturnType<typeof useShippingSelection> }) {
  await waitFor(() => expect(result.current.provinces).not.toBeNull());
  await act(async () => {
    await result.current.handleProvinceChange("P1");
  });
  await act(async () => {
    await result.current.handleCityChange("C1");
  });
  act(() => {
    result.current.handleDistrictChange("D1");
  });
}

describe("useShippingSelection", () => {
  it("loads a province's cities and clears any previously selected city, district and rates", async () => {
    const { result } = renderHook(() => useShippingSelection());
    await selectDistrict(result);

    await act(async () => {
      await result.current.handleGetRate([{ variantId: "v1", quantity: 1 }]);
    });
    expect(result.current.rates).toEqual(rates);
    expect(result.current.selectedServiceCode).toBe("REG");
    expect(result.current.selectedCityCode).toBe("C1");
    expect(result.current.selectedDistrict).toEqual(districts[0]);

    await act(async () => {
      await result.current.handleProvinceChange("P1");
    });

    expect(result.current.cities).toEqual(cities);
    expect(result.current.selectedCityCode).toBe("");
    expect(result.current.selectedDistrict).toBeNull();
    expect(result.current.districts).toBeNull();
    expect(result.current.rates).toBeNull();
    expect(result.current.selectedServiceCode).toBeNull();
  });

  it("posts the given items to shipping-rates and populates rates on success", async () => {
    const { result } = renderHook(() => useShippingSelection());
    await selectDistrict(result);

    const items = [{ variantId: "v1", quantity: 2 }];
    await act(async () => {
      await result.current.handleGetRate(items);
    });

    expect(invoke).toHaveBeenCalledWith("shipping-rates", {
      body: { destinationDistrictCode: "D1", items },
    });
    expect(result.current.rates).toEqual(rates);
    expect(result.current.selectedServiceCode).toBe("REG");
    expect(result.current.rateError).toBeNull();
  });

  it("sets a rate error and does not call shipping-rates for an empty items array", async () => {
    const { result } = renderHook(() => useShippingSelection());
    await selectDistrict(result);
    invoke.mockClear();

    await act(async () => {
      await result.current.handleGetRate([]);
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.rateError).toBe("Add at least one item before getting a shipping rate.");
    expect(result.current.rates).toBeNull();
  });

  it("resetRates clears rates, selectedServiceCode and rateError together", async () => {
    const { result } = renderHook(() => useShippingSelection());
    await selectDistrict(result);

    await act(async () => {
      await result.current.handleGetRate([]);
    });
    expect(result.current.rateError).not.toBeNull();

    act(() => result.current.resetRates());
    expect(result.current.rateError).toBeNull();

    await act(async () => {
      await result.current.handleGetRate([{ variantId: "v1", quantity: 1 }]);
    });
    expect(result.current.rates).not.toBeNull();
    expect(result.current.selectedServiceCode).not.toBeNull();

    act(() => result.current.resetRates());

    expect(result.current.rates).toBeNull();
    expect(result.current.selectedServiceCode).toBeNull();
    expect(result.current.rateError).toBeNull();
  });
});
