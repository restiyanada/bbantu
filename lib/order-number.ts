export function formatOrderNumber(
  fulfilmentMethod: string | null,
  orderNumber: number | null,
  fallbackId: string
): string {
  if (orderNumber == null || !fulfilmentMethod) {
    return fallbackId.slice(0, 8);
  }
  const typeCode = fulfilmentMethod === "SHIPPING" ? "02" : "01";
  return `#${typeCode}${String(orderNumber).padStart(4, "0")}`;
}

export interface ParsedOrderNumber {
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  orderNumber: number;
}

export function parseOrderNumber(input: string): ParsedOrderNumber | null {
  const trimmed = input.trim().replace(/^#/, "");
  const match = /^(01|02)(\d{4,})$/.exec(trimmed);
  if (!match) return null;

  return {
    fulfilmentMethod: match[1] === "02" ? "SHIPPING" : "PICKUP",
    orderNumber: Number.parseInt(match[2], 10),
  };
}
