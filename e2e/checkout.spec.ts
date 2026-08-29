import { test, expect } from "@playwright/test";

// Fixture data for the storefront's three parallel reads (products, batches,
// payment settings), stubbed so this test runs against no real backend —
// deterministic, and doesn't need any Supabase credentials to be meaningful.
async function stubStorefront(page: import("@playwright/test").Page) {
  await page.route("**/rest/v1/products*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "p1",
          name: "Kaos Katun Combed",
          description: "Cotton combed 30s",
          image_url: null,
          product_images: [],
          product_variants: [
            { id: "v1", name: "M", price: "145000" },
            { id: "v2", name: "L", price: "145000" },
          ],
        },
      ]),
    })
  );
  await page.route("**/rest/v1/batches*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/rest/v1/payment_settings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bank_name: "BCA", account_number: "123", account_holder_name: "Test Shop" }),
    })
  );
}

test("checkout shows an itemized breakdown on the review step", async ({ page }) => {
  await stubStorefront(page);
  await page.goto("/");

  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();

  // Add one L.
  const lRow = page.locator("span", { hasText: /^L — Rp 145\.000$/ });
  await lRow.locator("xpath=ancestor::div[1]//button[2]").click();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();

  await page.getByLabel("Name").fill("Test Customer");
  await page.getByLabel("Phone number").fill("081234567890");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByText("Pickup", { exact: false }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Order summary")).toBeVisible();
  // The regression this covers: the review step used to show only the
  // subtotal, with no line items at all — a customer had no way to see what
  // they were about to pay for.
  await expect(page.getByText("Kaos Katun Combed — L × 1")).toBeVisible();
  await expect(page.getByText("Merchandise subtotal")).toBeVisible();
});

test("a wrong order-tracker token shows a clean not-found state", async ({ page }) => {
  await page.route("**/functions/v1/get-order", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ found: false }) })
  );

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/orders/some-invalid-token");
  await expect(page.getByText("Order not found")).toBeVisible();
  expect(errors).toEqual([]);
});
