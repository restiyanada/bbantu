import { test, expect } from "@playwright/test";
import { stubFunction, trackerOrder } from "./fixtures";

test("a valid order link shows the order, its items and totals", async ({ page }) => {
  await stubFunction(page, "get-order", trackerOrder());

  await page.goto("/orders/valid-token");

  await expect(page.getByRole("heading", { name: /Order #01/ })).toBeVisible();
  await expect(page.getByText("Kaos Katun Combed — L")).toBeVisible();
  await expect(page.getByText("Merchandise subtotal")).toBeVisible();
  await expect(page.getByText("Rp 145.000").first()).toBeVisible();
});

test("a wrong token shows a clean not-found state with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await stubFunction(page, "get-order", { found: false });

  await page.goto("/orders/some-invalid-token");
  await expect(page.getByText("Order not found")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a rejected payment tells the customer why and lets them resubmit", async ({ page }) => {
  await stubFunction(
    page,
    "get-order",
    trackerOrder({
      payments: [
        {
          id: "pay1",
          status: "REJECTED",
          amount: "145000",
          rejection_reason: "Transfer amount doesn't match order total",
          submitted_at: new Date().toISOString(),
        },
      ],
    })
  );

  await page.goto("/orders/valid-token");

  await expect(page.getByText(/Transfer amount doesn't match order total/)).toBeVisible();
});

test("a ready-for-pickup order shows the pickup code", async ({ page }) => {
  await stubFunction(
    page,
    "get-order",
    trackerOrder({
      order: { ...trackerOrder().order, status: "READY_FOR_PICKUP" },
      payments: [
        { id: "pay1", status: "VERIFIED", amount: "145000", rejection_reason: null, submitted_at: new Date().toISOString() },
      ],
      pickupToken: "ABC123",
    })
  );

  await page.goto("/orders/valid-token");

  await expect(page.getByText("ABC123")).toBeVisible();
});

test("a shipped order shows the courier and tracking number", async ({ page }) => {
  await stubFunction(
    page,
    "get-order",
    trackerOrder({
      order: { ...trackerOrder().order, status: "SHIPPED", fulfilment_method: "SHIPPING", shipping_cost: "20000" },
      payments: [
        { id: "pay1", status: "VERIFIED", amount: "165000", rejection_reason: null, submitted_at: new Date().toISOString() },
      ],
      shipment: {
        courier: "JNE",
        service: "REG",
        tracking_number: "JNE123456789",
        recipient_name: "Siti Rahayu",
        address: "Jl. Test 1",
        destination_district_name: "Test District",
        cost: "20000",
      },
    })
  );

  await page.goto("/orders/valid-token");

  await expect(page.getByText("JNE123456789")).toBeVisible();
});
