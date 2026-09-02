import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, stubTable, type AdminPermissions } from "./fixtures";

const VARIANT = { id: "v2", name: "L", price: "145000", products: { name: "Kaos Katun Combed" } };

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    name: "Q3 Hoodie Drop",
    open_at: "2026-01-01T00:00:00.000Z",
    close_at: "2026-02-01T00:00:00.000Z",
    status: "OPEN",
    allowed_payment_types: ["DP", "FULL"],
    allowed_fulfilment_methods: ["PICKUP"],
    batch_items: [{ id: "bi1", moq: 10, procured_quantity: 0, product_variants: VARIANT }],
    ...overrides,
  };
}

async function openBatches(
  page: Page,
  batches: unknown[] = [batch()],
  permissions: AdminPermissions = {},
  orderItems: unknown[] = []
) {
  await loginAsAdmin(page, permissions);
  await stubTable(page, "product_variants", [VARIANT]);
  await stubTable(page, "batches", batches);
  await stubTable(page, "inventory", [{ variant_id: "v2", on_hand: 4, reserved: 2 }]);
  await stubTable(page, "orders", [{ id: "o1", batch_id: "b1", status: "PAYMENT_VERIFIED" }]);
  await stubTable(page, "order_items", orderItems);
  await page.goto("/admin/batches");
  await expect(page.getByRole("heading", { name: "Batches" })).toBeVisible({ timeout: 10000 });
}

test("lists a batch with its payment terms, items and stock counts", async ({ page }) => {
  await openBatches(page, [batch()], {}, [{ order_id: "o1", variant_id: "v2", quantity: 3 }]);

  await expect(page.getByText("Q3 Hoodie Drop")).toBeVisible();
  await expect(page.getByText("50% deposit")).toBeVisible();
  await expect(page.getByText("Full payment")).toBeVisible();
  await expect(page.getByText("Kaos Katun Combed — L")).toBeVisible();
  await expect(page.getByText(/Ordered\s*3\s*\/ MOQ 10/)).toBeVisible();
  await expect(page.getByText(/On hand\s*4/)).toBeVisible();
  await expect(page.getByText(/Reserved\s*2/)).toBeVisible();
});

test("an order count past the MOQ is flagged", async ({ page }) => {
  await openBatches(page, [batch()], {}, [{ order_id: "o1", variant_id: "v2", quantity: 25 }]);

  await expect(page.getByText("over MOQ")).toBeVisible();
});

test("recording a receipt sends the quantity and reports what it promoted", async ({ page }) => {
  await openBatches(page);

  let receiptBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/record-batch-receipt", (route) => {
    receiptBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ received: 10, promoted: 2, stillWaiting: 1 }),
    });
  });

  await page.getByPlaceholder("Qty received").fill("10");
  await page.getByRole("button", { name: "Record receipt" }).click();

  await expect(page.getByText("Recorded 10 units. 2 order(s) promoted, 1 still waiting.")).toBeVisible();
  expect(receiptBody).toMatchObject({ batchItemId: "bi1", quantityReceived: 10 });
});

test("a non-numeric receipt quantity is refused before any request goes out", async ({ page }) => {
  await openBatches(page);

  let called = false;
  await page.route("**/functions/v1/record-batch-receipt", (route) => {
    called = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.getByPlaceholder("Qty received").fill("-2");
  await page.getByRole("button", { name: "Record receipt" }).click();

  await expect(page.getByText("Enter a whole number greater than zero.")).toBeVisible();
  expect(called).toBe(false);
});

test("permissions gate batch creation and inventory receipts separately", async ({ page }) => {
  await openBatches(page, [batch()], { canManageProductsBatches: false, canAdjustInventory: false });

  await expect(page.getByRole("button", { name: "New batch" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record receipt" })).toBeDisabled();
  await expect(page.getByRole("combobox")).toBeDisabled();
});
