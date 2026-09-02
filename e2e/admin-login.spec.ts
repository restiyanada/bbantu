import { test, expect } from "@playwright/test";
import { stubFunction } from "./fixtures";

test("signing in with a correct password lands on the dashboard", async ({ page }) => {
  await page.route("**/auth/v1/token*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "fake-access-token",
        refresh_token: "fake-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: "11111111-1111-1111-1111-111111111111",
          aud: "authenticated",
          role: "authenticated",
          email: "admin@example.com",
        },
      }),
    })
  );
  await stubFunction(page, "whoami", {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Test Admin",
    email: "admin@example.com",
    canVerifyPayments: true,
    canScanConfirmPickup: true,
    canManageProductsBatches: true,
    canAdjustInventory: true,
    canManageShipping: true,
    canViewAuditLog: true,
  });
  await stubFunction(page, "list-orders", { orders: [] });
  await stubFunction(page, "shipping-label-info", {});

  await page.goto("/admin/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("correct-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Regression guard: signInWithPassword only establishes a session — nothing
  // navigates unless AdminLoginPage explicitly says so. This shipped broken once.
  await page.waitForURL("**/dashboard", { timeout: 10000 });
});

test("a wrong password shows an error and does not navigate", async ({ page }) => {
  await page.route("**/auth/v1/token*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }),
    })
  );

  await page.goto("/admin/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/admin/login");
});

test("a network failure reads as a connection problem, not a wrong password", async ({ page }) => {
  // supabase-js surfaces network failures as AuthRetryableFetchError; showing
  // "Incorrect email or password" for those sent debugging down the wrong path.
  await page.route("**/auth/v1/token*", (route) => route.abort("failed"));

  await page.goto("/admin/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("some-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/taking too long/i)).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("forgot password sends a reset link and confirms it", async ({ page }) => {
  await page.route("**/auth/v1/recover*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  );

  await page.goto("/admin/login");
  await page.getByText("Forgot password?").click();
  await page.locator("#reset-email").fill("admin@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText(/check/i)).toBeVisible();
  await expect(page.getByText("admin@example.com")).toBeVisible();
});

test("the accept-invite page rejects a link with no session", async ({ page }) => {
  await page.goto("/admin/accept-invite");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible({ timeout: 10000 });
});
