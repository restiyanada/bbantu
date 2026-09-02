import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, stubFunction, adminOrder, type AdminPermissions } from "./fixtures";

async function openDashboard(
  page: Page,
  orders: unknown[],
  permissions: AdminPermissions = {}
) {
  await loginAsAdmin(page, permissions);
  await stubFunction(page, "list-orders", { orders });
  await stubFunction(page, "shipping-label-info", {});
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible({ timeout: 10000 });
}

test("lists orders and opens the detail drawer with line items", async ({ page }) => {
  await openDashboard(page, [adminOrder()]);

  await expect(page.getByText("Siti Rahayu")).toBeVisible();
  await page.getByRole("button", { name: "Open" }).click();

  // The drawer used to show only a total — list-orders never selected items.
  await expect(page.getByText("Kaos Katun Combed — L × 1")).toBeVisible();
});

test("searching narrows the order list", async ({ page }) => {
  await openDashboard(page, [
    adminOrder(),
    adminOrder({ id: "o2", orderNumber: 8, customerName: "Budi Santoso" }),
  ]);

  await expect(page.getByText("Budi Santoso")).toBeVisible();
  await page.getByPlaceholder(/Search by customer/).fill("Siti");

  await expect(page.getByText("Siti Rahayu")).toBeVisible();
  await expect(page.getByText("Budi Santoso")).not.toBeVisible();
});

test("verifying a payment calls verify-payment and confirms", async ({ page }) => {
  await openDashboard(page, [adminOrder()]);

  let verifyBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/verify-payment", (route) => {
    verifyBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", decision: "VERIFY", orderStatus: "RESERVED" }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("Payment verified")).toBeVisible();
  expect(verifyBody).toMatchObject({ orderId: "o1", decision: "VERIFY" });
});

test("rejecting a payment requires a reason and sends it", async ({ page }) => {
  await openDashboard(page, [adminOrder()]);

  let rejectBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/verify-payment", (route) => {
    rejectBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", decision: "REJECT", orderStatus: null }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await page.locator("#reason").fill("Transfer amount doesn't match");
  await page.getByRole("button", { name: "Reject payment" }).click();

  await expect(page.getByText("Payment rejected")).toBeVisible();
  expect(rejectBody).toMatchObject({
    orderId: "o1",
    decision: "REJECT",
    rejectionReason: "Transfer amount doesn't match",
  });
});

test("an admin without canVerifyPayments cannot verify or reject", async ({ page }) => {
  await openDashboard(page, [adminOrder()], { canVerifyPayments: false });

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject" })).toBeDisabled();
});

test("preparing a pickup order calls prepare-pickup", async ({ page }) => {
  await openDashboard(page, [
    adminOrder({ status: "READY_FOR_FULFILMENT", payment: { ...adminOrder().payment, status: "VERIFIED" } }),
  ]);

  let prepareBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/prepare-pickup", (route) => {
    prepareBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", status: "READY_FOR_PICKUP", pickupToken: "ABC123" }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Prepare for pickup" }).click();

  await expect(page.getByText("Order marked ready")).toBeVisible();
  expect(prepareBody).toMatchObject({ orderId: "o1" });
});

test("recording tracking on a shipping order calls record-tracking", async ({ page }) => {
  await openDashboard(page, [
    adminOrder({
      fulfilmentMethod: "SHIPPING",
      status: "READY_TO_SHIP",
      shippingCost: "20000",
      payment: { ...adminOrder().payment, status: "VERIFIED" },
      shipment: {
        courier: "JNE",
        service: "REG",
        recipientName: "Siti Rahayu",
        recipientPhone: "081234567890",
        address: "Jl. Test 1",
        destinationDistrictName: "Test District",
        trackingNumber: null,
        cost: "20000",
      },
    }),
  ]);

  let trackingBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/record-tracking", (route) => {
    trackingBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", status: "SHIPPED" }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Record tracking" }).click();
  await page.locator("form").getByRole("textbox").first().fill("JNE123456789");
  await page.getByRole("button", { name: "Mark shipped" }).click();

  await expect(page.getByText("Tracking recorded")).toBeVisible();
  expect(trackingBody).toMatchObject({ orderId: "o1", trackingNumber: "JNE123456789" });
});

test("a failing action surfaces the real server error, not a generic one", async ({ page }) => {
  await openDashboard(page, [adminOrder()]);

  await page.route("**/functions/v1/verify-payment", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "No pending payment to verify for this order." }),
    })
  );

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("No pending payment to verify for this order.")).toBeVisible();
});
