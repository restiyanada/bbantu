import { test, expect, type Page } from "@playwright/test";
import { stubStorefront, stubTable, stubFunction, trackerOrder, TEST_PRODUCT } from "./fixtures";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function pickOneL(page: Page) {
  const lRow = page.locator("span", { hasText: /^L — Rp 145\.000$/ });
  await lRow.locator("xpath=ancestor::div[1]//button[2]").click();
}

async function fillDetails(page: Page) {
  await page.getByLabel("Name").fill("Test Customer");
  await page.getByLabel("Phone number").fill("081234567890");
  await page.getByLabel("Email").fill("test@example.com");
}

async function uploadProof(page: Page) {
  await page.route("**/storage/v1/object/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "proofs/x.png" }) })
  );
  await page.setInputFiles('input[type="file"]', {
    name: "proof.png",
    mimeType: "image/png",
    buffer: PNG_1PX,
  });
}

test("placing a ready-stock order sends the right payload and lands on the tracker", async ({ page }) => {
  await stubStorefront(page);

  let orderBody: Record<string, unknown> | null = null;
  await page.route("**/functions/v1/create-order", (route) => {
    orderBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orderId: "o1", orderNumber: 7, accessToken: "raw-access-token" }),
    });
  });
  await stubFunction(page, "get-order", trackerOrder());

  await page.goto("/");
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await pickOneL(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await fillDetails(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Order summary")).toBeVisible();

  await uploadProof(page);
  await page.getByRole("button", { name: "Place order" }).click();

  await page.waitForURL("**/orders/raw-access-token", { timeout: 15000 });
  await expect(page.getByRole("heading", { name: /Order #01/ })).toBeVisible();

  expect(orderBody).toMatchObject({
    items: [{ variantId: "v2", quantity: 1 }],
    fulfilmentMethod: "PICKUP",
    customer: { name: "Test Customer", phone: "081234567890", email: "test@example.com" },
  });
  // The proof is uploaded under the submission token, and the same token is the
  // idempotency key — a retried submit must not create a second order.
  const body = orderBody as unknown as { submissionToken: string; proofFileUrl: string };
  expect(body.submissionToken).toBeTruthy();
  expect(body.proofFileUrl).toContain(`${body.submissionToken}/`);
  expect(body.proofFileUrl).toMatch(/proof\.png$/);
});

test("an order cannot be placed without a payment proof", async ({ page }) => {
  await stubStorefront(page);

  let called = false;
  await page.route("**/functions/v1/create-order", (route) => {
    called = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await pickOneL(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await fillDetails(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Order summary")).toBeVisible();

  // The submit button stays disabled until a proof has finished uploading, so
  // there is no way to reach create-order without one.
  await expect(page.getByRole("button", { name: "Place order" })).toBeDisabled();
  expect(called).toBe(false);
});

test("an open pre-order batch is offered with its own payment terms", async ({ page }) => {
  await stubTable(page, "products", [TEST_PRODUCT]);
  await stubTable(page, "payment_settings", {
    bank_name: "BCA",
    account_number: "1234567890",
    account_holder_name: "Test Shop",
  });
  await stubTable(page, "batches", [
    {
      id: "b1",
      name: "Q3 Hoodie Drop",
      allowed_payment_types: ["DP", "FULL"],
      allowed_fulfilment_methods: ["PICKUP"],
      batch_items: [
        {
          id: "bi1",
          variant_id: "v2",
          product_variants: {
            name: "L",
            price: "145000",
            products: {
              name: "Kaos Katun Combed",
              description: "Cotton combed 30s",
              image_url: null,
              product_images: [],
            },
          },
        },
      ],
    },
  ]);

  await page.goto("/");
  await expect(page.getByText("Q3 Hoodie Drop")).toBeVisible();
});
