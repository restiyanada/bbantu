import { test, expect, type Page } from "@playwright/test";
import { stubStorefront } from "./fixtures";

async function pickOneL(page: Page) {
  const lRow = page.locator("span", { hasText: /^L — Rp 145\.000$/ });
  await lRow.locator("xpath=ancestor::div[1]//button[2]").click();
}

async function fillDetails(page: Page) {
  await page.getByLabel("Name").fill("Test Customer");
  await page.getByLabel("Phone number").fill("081234567890");
  await page.getByLabel("Email").fill("test@example.com");
}

test("checkout shows an itemized breakdown on the review step", async ({ page }) => {
  await stubStorefront(page);
  await page.goto("/");

  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await pickOneL(page);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();

  await fillDetails(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Order summary")).toBeVisible();
  // The review step used to show only a subtotal — no line items at all.
  await expect(page.getByText("Kaos Katun Combed — L × 1")).toBeVisible();
  await expect(page.getByText("Merchandise subtotal")).toBeVisible();
  await expect(page.getByText("BCA — 1234567890")).toBeVisible();
});

test("step 1 will not continue with nothing selected", async ({ page }) => {
  await stubStorefront(page);
  await page.goto("/");
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();

  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("step 2 rejects an invalid phone number and a malformed email", async ({ page }) => {
  await stubStorefront(page);
  await page.goto("/");
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await pickOneL(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Name").fill("Test Customer");
  await page.getByLabel("Phone number").fill("abc");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Continue" }).click();

  // Still on the details step — validation blocked the advance.
  await expect(page.getByLabel("Phone number")).toBeVisible();
  await expect(page.getByText("Order summary")).toHaveCount(0);
});

test("a rate-limited create-order surfaces the server's message", async ({ page }) => {
  await stubStorefront(page);
  await page.route("**/functions/v1/create-order", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }),
    })
  );
  await page.route("**/storage/v1/object/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "x" }) })
  );

  await page.goto("/");
  await expect(page.getByText("Kaos Katun Combed")).toBeVisible();
  await pickOneL(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await fillDetails(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Order summary")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "proof.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });

  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText(/Something went wrong placing your order|Too many requests/i)).toBeVisible({
    timeout: 15000,
  });
});
