import { describe, it, expect } from "vitest";
import { formatOrderNumber, parseOrderNumber } from "./order-number";

describe("formatOrderNumber", () => {
  it("formats a pickup order", () => {
    expect(formatOrderNumber("PICKUP", 7, "fallback-uuid")).toBe("#010007");
  });

  it("formats a shipping order", () => {
    expect(formatOrderNumber("SHIPPING", 7, "fallback-uuid")).toBe("#020007");
  });

  it("doesn't truncate beyond 4 digits", () => {
    expect(formatOrderNumber("PICKUP", 10007, "fallback-uuid")).toBe("#0110007");
  });

  it("falls back to a short id slice when orderNumber or fulfilmentMethod is missing", () => {
    expect(formatOrderNumber(null, null, "abcdefgh-1234")).toBe("abcdefgh");
    expect(formatOrderNumber(null, 7, "abcdefgh-1234")).toBe("abcdefgh");
    expect(formatOrderNumber("PICKUP", null, "abcdefgh-1234")).toBe("abcdefgh");
  });
});

describe("parseOrderNumber (§16.2, Milestone 6 recovery)", () => {
  it("parses a pickup order number", () => {
    expect(parseOrderNumber("#010007")).toEqual({ fulfilmentMethod: "PICKUP", orderNumber: 7 });
  });

  it("parses a shipping order number", () => {
    expect(parseOrderNumber("#020007")).toEqual({ fulfilmentMethod: "SHIPPING", orderNumber: 7 });
  });

  it("accepts the input without a leading #", () => {
    expect(parseOrderNumber("010007")).toEqual({ fulfilmentMethod: "PICKUP", orderNumber: 7 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseOrderNumber("  #010007  ")).toEqual({ fulfilmentMethod: "PICKUP", orderNumber: 7 });
  });

  it("round-trips with formatOrderNumber", () => {
    const formatted = formatOrderNumber("SHIPPING", 42, "fallback");
    expect(parseOrderNumber(formatted)).toEqual({ fulfilmentMethod: "SHIPPING", orderNumber: 42 });
  });

  it("rejects an unknown type code", () => {
    expect(parseOrderNumber("#030007")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseOrderNumber("not-an-order-number")).toBeNull();
    expect(parseOrderNumber("#01")).toBeNull();
    expect(parseOrderNumber("")).toBeNull();
  });

  it("rejects the short-id fallback form (not a stable identifier to recover by)", () => {
    expect(parseOrderNumber("abcdefgh")).toBeNull();
  });
});
