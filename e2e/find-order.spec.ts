import { test, expect } from "@playwright/test";
import { stubFunction } from "./fixtures";

test("finds an order by phone and order number", async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/recover-order-access", (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        found: true,
        order: {
          orderNumber: "#010007",
          status: "PAYMENT_VERIFIED",
          fulfilmentMethod: "PICKUP",
          url: "https://example.com/orders/raw-token",
        },
      }),
    });
  });

  await page.goto("/orders/find");
  await page.locator("#phone").fill("081234567890");
  await page.locator("#orderNumber").fill("#010007");
  await page.getByRole("button", { name: /find my order/i }).click();

  await expect(page.getByText("Found your order:")).toBeVisible();
  await expect(page.getByRole("link", { name: /#010007/ })).toBeVisible();
  expect(requestBody).toMatchObject({ phone: "081234567890", orderNumber: "#010007" });
});

test("a non-matching phone/order number pair says so without leaking anything", async ({ page }) => {
  await stubFunction(page, "recover-order-access", { found: false });

  await page.goto("/orders/find");
  await page.locator("#phone").fill("081200000000");
  await page.locator("#orderNumber").fill("#019999");
  await page.getByRole("button", { name: /find my order/i }).click();

  await expect(page.getByText(/couldn't find an order matching/i)).toBeVisible();
});

test("a server error is reported as a temporary problem, not 'not found'", async ({ page }) => {
  await stubFunction(page, "recover-order-access", { error: "Too many requests." }, 429);

  await page.goto("/orders/find");
  await page.locator("#phone").fill("081234567890");
  await page.locator("#orderNumber").fill("#010007");
  await page.getByRole("button", { name: /find my order/i }).click();

  await expect(page.getByText(/couldn't look that up right now/i)).toBeVisible();
});
