import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, stubTable, TEST_PRODUCT, type AdminPermissions } from "./fixtures";

async function openProducts(page: Page, permissions: AdminPermissions = {}) {
  await loginAsAdmin(page, permissions);
  await stubTable(page, "products", [TEST_PRODUCT]);
  await stubTable(page, "inventory", [
    { variant_id: "v1", on_hand: 12, reserved: 3 },
    { variant_id: "v2", on_hand: 5, reserved: 0 },
  ]);
  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible({ timeout: 10000 });
}

test("lists products with each variant's price and stock", async ({ page }) => {
  await openProducts(page);

  await expect(page.getByText("Existing products")).toBeVisible();
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await expect(page.getByText("M — Rp 145.000")).toBeVisible();
  await expect(page.getByText("on hand: 12 · reserved: 3")).toBeVisible();
  await expect(page.getByText("on hand: 5 · reserved: 0")).toBeVisible();
});

test("the new-product dialog validates before it will submit", async ({ page }) => {
  await openProducts(page);

  await page.getByRole("button", { name: "New product" }).click();
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();

  // Nothing filled in — the dialog must stay open rather than POST an empty product.
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
});

test("an admin without canManageProductsBatches cannot create or edit", async ({ page }) => {
  await openProducts(page, { canManageProductsBatches: false });

  await expect(page.getByRole("button", { name: "New product" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled();
});

test("a failed load offers a retry instead of an empty page", async ({ page }) => {
  await loginAsAdmin(page);
  let attempts = 0;
  await page.route("**/rest/v1/products*", (route) => {
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "internal error" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([TEST_PRODUCT]),
    });
  });
  await stubTable(page, "inventory", []);

  await page.goto("/admin/products");
  await expect(page.getByText("Couldn't load products. Please try refreshing.")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
});
