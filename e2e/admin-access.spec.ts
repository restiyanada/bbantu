import { test, expect } from "@playwright/test";
import { loginAsAdmin, stubFunction } from "./fixtures";

const PROTECTED = ["/dashboard", "/admin/products", "/admin/batches", "/admin/audit-log", "/scan"];

for (const path of PROTECTED) {
  test(`${path} sends a signed-out visitor to the login page`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL("**/admin/login", { timeout: 10000 });
    await expect(page.locator("#password")).toBeVisible();
  });
}

test("a signed-in user who is not an admin is refused, not shown the dashboard", async ({ page }) => {
  await loginAsAdmin(page);
  // A valid Supabase session whose user has no row in the admins table.
  await stubFunction(page, "whoami", { error: "Not an admin." }, 403);

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Not authorized" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Orders" })).toHaveCount(0);
});

test("a nav link to a page this admin lacks permission for is refused at the page", async ({ page }) => {
  // The sidebar shows every link to every admin — the pages do the gating, so
  // following a link you have no permission for must land on a clear refusal
  // rather than a blank or half-rendered page.
  await loginAsAdmin(page, { canViewAuditLog: false });
  await stubFunction(page, "list-orders", { orders: [] });
  await stubFunction(page, "shipping-label-info", {});

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible({ timeout: 10000 });

  await page.getByRole("complementary").getByRole("link", { name: /Audit log/i }).click();

  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByText(/doesn't have the "View audit log" permission/)).toBeVisible();
});
