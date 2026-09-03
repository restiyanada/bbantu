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

test("cancelling an order sends the reason", async ({ page }) => {
  await openDashboard(page, [adminOrder({ status: "READY_FOR_FULFILMENT" })]);

  let cancelBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/cancel-order", (route) => {
    cancelBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", status: "CANCELLED", stockReleased: true }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.locator("#reason").fill("Customer requested cancellation");
  await page.getByRole("button", { name: "Cancel order" }).click();

  await expect(page.getByText("Order cancelled")).toBeVisible();
  expect(cancelBody).toMatchObject({ orderId: "o1", reason: "Customer requested cancellation" });
});

test("an empty cancellation reason is refused client-side and no request goes out", async ({ page }) => {
  await openDashboard(page, [adminOrder({ status: "READY_FOR_FULFILMENT" })]);

  let called = false;
  await page.route("**/functions/v1/cancel-order", (route) => {
    called = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", status: "CANCELLED", stockReleased: true }),
    });
  });

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();

  await expect(page.getByText("A cancellation reason is required.")).toBeVisible();
  expect(called).toBe(false);
});

test("an admin without canVerifyPayments sees Cancel order disabled", async ({ page }) => {
  await openDashboard(
    page,
    [adminOrder({ status: "READY_FOR_FULFILMENT" })],
    { canVerifyPayments: false }
  );

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Cancel order" })).toBeDisabled();
});

test("a failing cancellation surfaces the real state-machine message", async ({ page }) => {
  await openDashboard(page, [adminOrder({ status: "READY_FOR_FULFILMENT" })]);

  await page.route("**/functions/v1/cancel-order", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Order is in SHIPPED — nothing to cancel." }),
    })
  );

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.locator("#reason").fill("Customer requested cancellation");
  await page.getByRole("button", { name: "Cancel order" }).click();

  await expect(page.getByText("Order is in SHIPPED — nothing to cancel.")).toBeVisible();
});
