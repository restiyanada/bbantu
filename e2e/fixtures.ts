import type { Page } from "@playwright/test";

// Every spec here runs against stubbed network calls rather than a real
// Supabase project: deterministic, no credentials, and safe to run on every
// push. The app only needs VITE_SUPABASE_URL to be *set* (supabaseClient.ts
// throws otherwise) — it never has to point anywhere real.
const PROJECT_REF = "example";

export interface AdminPermissions {
  canVerifyPayments?: boolean;
  canScanConfirmPickup?: boolean;
  canManageProductsBatches?: boolean;
  canAdjustInventory?: boolean;
  canManageShipping?: boolean;
  canViewAuditLog?: boolean;
}

/**
 * Seeds a Supabase session into localStorage before the app boots, so
 * AdminAuthProvider sees a logged-in user, and stubs `whoami` (the Edge
 * Function it calls to resolve the admin profile behind RequireAdmin).
 */
export async function loginAsAdmin(page: Page, permissions: AdminPermissions = {}) {
  const profile = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Test Admin",
    email: "admin@example.com",
    canVerifyPayments: true,
    canScanConfirmPickup: true,
    canManageProductsBatches: true,
    canAdjustInventory: true,
    canManageShipping: true,
    canViewAuditLog: true,
    ...permissions,
  };

  await page.addInitScript(
    ({ ref, user }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: "fake-access-token",
          refresh_token: "fake-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: expiresAt,
          user: {
            id: user.id,
            aud: "authenticated",
            role: "authenticated",
            email: user.email,
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        })
      );
    },
    { ref: PROJECT_REF, user: profile }
  );

  await stubFunction(page, "whoami", profile);
  // supabase-js refreshes the token on boot when it deems one near expiry.
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
        user: { id: profile.id, aud: "authenticated", role: "authenticated", email: profile.email },
      }),
    })
  );
}

/** Stubs one Edge Function's JSON response. */
export async function stubFunction(page: Page, name: string, body: unknown, status = 200) {
  await page.route(`**/functions/v1/${name}`, (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
  );
}

/** Stubs a PostgREST table read (the storefront and admin product/batch pages). */
export async function stubTable(page: Page, table: string, body: unknown) {
  await page.route(`**/rest/v1/${table}*`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  );
}

export const TEST_PRODUCT = {
  id: "p1",
  name: "Kaos Katun Combed",
  description: "Cotton combed 30s",
  image_url: null,
  active: true,
  product_images: [],
  product_variants: [
    { id: "v1", name: "M", price: "145000" },
    { id: "v2", name: "L", price: "145000" },
  ],
};

/** The three parallel reads HomePage makes on load. */
export async function stubStorefront(page: Page) {
  await stubTable(page, "products", [TEST_PRODUCT]);
  await stubTable(page, "batches", []);
  await stubTable(page, "payment_settings", {
    bank_name: "BCA",
    account_number: "1234567890",
    account_holder_name: "Test Shop",
  });
}

export function adminOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    orderNumber: 7,
    customerName: "Siti Rahayu",
    customerPhone: "081234567890",
    customerEmail: "siti@example.com",
    salesMode: "READY_STOCK",
    status: "PAYMENT_PENDING",
    paymentType: "FULL",
    fulfilmentMethod: "PICKUP",
    merchandiseSubtotal: "145000",
    shippingCost: null,
    amountPaid: "0",
    createdAt: new Date().toISOString(),
    batchName: null,
    items: [{ productName: "Kaos Katun Combed", variantName: "L", quantity: 1, unitPrice: "145000" }],
    payment: {
      id: "pay1",
      status: "PENDING",
      amount: "145000",
      proofUrl: null,
      proofDeletedAt: null,
      rejectionReason: null,
      submittedAt: new Date().toISOString(),
    },
    shipment: null,
    pickupToken: null,
    ...overrides,
  };
}

/** The shape get-order returns to the customer order tracker. */
export function trackerOrder(overrides: Record<string, unknown> = {}) {
  return {
    found: true,
    order: {
      id: "o1",
      order_number: 7,
      fulfilment_method: "PICKUP",
      sales_mode: "READY_STOCK",
      status: "PAYMENT_PENDING",
      payment_type: "FULL",
      created_at: new Date().toISOString(),
      merchandise_subtotal: "145000",
      shipping_cost: null,
      amount_paid: "0",
    },
    items: [
      {
        quantity: 1,
        unit_price: "145000",
        product_name: "Kaos Katun Combed",
        variant_name: "L",
        image_urls: [],
      },
    ],
    payments: [],
    pickupToken: null,
    shipment: null,
    batchName: null,
    ...overrides,
  };
}
