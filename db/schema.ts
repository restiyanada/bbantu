import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  pgPolicy,
  pgSequence,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

// ── Enums (PRD §9 order states, §8 payment, §5 sales mode, §10 batch, §17 email) ──

export const salesModeEnum = pgEnum("sales_mode", ["PRE_ORDER", "READY_STOCK"]);

export const batchStatusEnum = pgEnum("batch_status", [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "PROCUREMENT",
  "AWAITING_STOCK",
  "RECEIVED",
  "FULFILMENT",
  "COMPLETED",
]);

export const paymentTypeEnum = pgEnum("payment_type", ["DP", "FULL"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "PAYMENT_PENDING",
  "PAYMENT_VERIFIED",
  "RESERVED",
  "AWAITING_STOCK",
  "BALANCE_DUE",
  "READY_FOR_FULFILMENT",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
  "REFUND_REQUIRED",
]);

export const fulfilmentMethodEnum = pgEnum("fulfilment_method", [
  "PICKUP",
  "SHIPPING",
]);

export const emailPriorityEnum = pgEnum("email_priority", ["P0", "P1", "P2"]);

export const emailStatusEnum = pgEnum("email_status", [
  "QUEUED",
  "SENT",
  "FAILED",
]);

// ── Admin identity & permissions (§18.4) — defined early, since RLS
// policies further down in this file (products, batches, inventory, orders)
// need to reference admin_users to check "is this caller a staff member /
// do they have permission X". ──

// RLS enabled with no policies for direct table access: nothing reads or
// writes admin_users directly (no browser client, not even an authenticated
// one) — Edge Functions use the service-role connection, which bypasses RLS
// entirely. Other tables' policies below reference this table *from inside
// their own policy definition* (a `using`/`with check` subquery), which is
// evaluated with the privileges of the query issuer, not of admin_users'
// own (nonexistent) policies — so "no policies here" doesn't block those.
//
// Milestone 4: passwordHash removed. architecture.md specifies Supabase Auth
// magic-link only (no password ever collected or checked), so the column
// flagged here since Milestone 1 as a mismatch is now resolved by deleting
// it rather than leaving it unused.
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  canVerifyPayments: boolean("can_verify_payments").notNull().default(false),
  canScanConfirmPickup: boolean("can_scan_confirm_pickup")
    .notNull()
    .default(false),
  canManageProductsBatches: boolean("can_manage_products_batches").notNull().default(false),
  canAdjustInventory: boolean("can_adjust_inventory").notNull().default(false),
  canManageShipping: boolean("can_manage_shipping").notNull().default(false),
  canViewAuditLog: boolean("can_view_audit_log").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();

// §18.4 — a staff member's identity comes from a real Supabase Auth session
// (magic link), not the custom-header trick guests use (requestAccessToken
// further down). Postgres's `auth.jwt()` is populated by Supabase's own
// authenticator role from the request's Authorization JWT, so no custom
// header/GUC is needed here — just read the email claim straight out of it.
const requestAdminEmail = sql`(auth.jwt() ->> 'email')`;

/** Matches any authenticated staff member, regardless of which specific permissions they hold. */
const isAnyAdmin = sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail})`;

// ── Core entities (PRD §21 Suggested Domain Model) ──

// RLS enabled with no policies: PII (name/phone/email) is never read
// directly by the browser under any role. Order creation and every other
// write/read of this table goes through an Edge Function using the service
// role connection, which bypasses RLS entirely — see architecture.md
// "Security boundary".
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();

// Milestone 4: RLS enabled. Previously this table had none at all, which
// meant any caller holding the public anon key could INSERT/UPDATE/DELETE
// products directly (not a hypothetical — AdminProductsPage does exactly
// that with the plain browser client). Read stays open to everyone
// (unchanged from before — the storefront needs it, and product names/
// prices/images were never sensitive); only writes now require an
// authenticated staff session with canManageProductsBatches (§18.4).
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    // One image per product (Milestone 2 decision): a product with two colors
    // is modeled as two separate products, each with its own image — not a
    // color dimension on variants. Public URL in the public `product-images`
    // Storage bucket (supabase/product_images_storage_setup.sql), not a
    // private path — unlike payment proofs, there's nothing sensitive here and
    // the storefront needs to render it directly in an <img> tag.
    imageUrl: text("image_url"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (_table) => [
    pgPolicy("anyone_can_read_products", { for: "select", to: ["anon", "authenticated"], using: sql`true` }),
    pgPolicy("staff_can_manage_products", {
      for: "all",
      to: "authenticated",
      using: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
      withCheck: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
    }),
  ]
).enableRLS();

// Same reasoning and same two policies as products above — variants are
// created/edited in the same AdminProductsPage flow, so they need the same
// "public read, staff-only write" shape.
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(), // e.g. size/design
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    // Milestone 3: needed to compute package weight for shipping-rate lookups
    // (§15.2 — api.co.id's rate endpoint requires a weight in kg). Nullable
    // rather than required, since every variant from Milestone 1/2 was created
    // without one — supabase/functions/_shared/shipping.ts falls back to a
    // documented default per item when this is unset, rather than rejecting
    // checkout for products nobody has gotten around to weighing yet.
    weightGrams: integer("weight_grams"),
  },
  (_table) => [
    pgPolicy("anyone_can_read_product_variants", { for: "select", to: ["anon", "authenticated"], using: sql`true` }),
    pgPolicy("staff_can_manage_product_variants", {
      for: "all",
      to: "authenticated",
      using: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
      withCheck: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
    }),
  ]
).enableRLS();

// Milestone 1: a single global row (admin edits it directly via SQL console
// for now). Milestone 2 upgrades this to per-batch bank accounts (§10.1) —
// deliberately not adding an unused batchId column now, since it wouldn't
// do anything until that batch work exists. No RLS: customers need to read
// this during checkout before they've even submitted an order (no access
// token exists yet to gate on), and it's not sensitive — it's information
// meant to be given to any prospective customer who needs to pay.
export const paymentSettings = pgTable("payment_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Milestone 3: the business's own shipping-from location, needed as the
// `origin_district_code` input to every rate lookup (§15.2). Single global
// row, admin-edited directly via SQL console — same precedent as
// payment_settings above (no per-batch origin; this is one physical
// business, not a multi-warehouse marketplace). No RLS: nothing here is
// customer PII, and the browser never reads this table directly anyway —
// only supabase/functions/shipping-rates does, via the service-role
// connection, so the origin code/address never needs to reach the client.
export const shippingSettings = pgTable("shipping_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  originDistrictCode: text("origin_district_code").notNull(), // api.co.id kecamatan code, e.g. "317405"
  originDistrictName: text("origin_district_name").notNull(), // human-readable, for the shipping label later
  originAddress: text("origin_address").notNull(), // street-level, for the shipping label later
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Milestone 4: RLS enabled — same "public read, staff-only write" shape and
// same reasoning as products above. Batch visibility to customers is
// unchanged (still world-readable, same as before this table had any RLS at
// all); only INSERT/UPDATE/DELETE now require canManageProductsBatches.
export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    openAt: timestamp("open_at").notNull(),
    closeAt: timestamp("close_at").notNull(),
    status: batchStatusEnum("status").notNull().default("DRAFT"),
    allowedPaymentTypes: paymentTypeEnum("allowed_payment_types").array().notNull(), // §10.1
    // §13.1/§26 (Milestone 2 note) — a batch can restrict fulfilment to
    // pickup, shipping, or both. Shipping isn't actually functional until
    // Milestone 3 (no address/cost calc yet), so the batch UI only lets an
    // admin pick PICKUP or [PICKUP, SHIPPING] for now — SHIPPING-only is
    // accepted here at the schema/data level but disabled in the UI, since
    // enforcing "no shipping-only batches" is a UI/product decision, not a
    // database constraint.
    allowedFulfilmentMethods: fulfilmentMethodEnum("allowed_fulfilment_methods").array().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (_table) => [
    pgPolicy("anyone_can_read_batches", { for: "select", to: ["anon", "authenticated"], using: sql`true` }),
    pgPolicy("staff_can_manage_batches", {
      for: "all",
      to: "authenticated",
      using: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
      withCheck: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
    }),
  ]
).enableRLS();

// Milestone 2 correction: MOQ and procured quantity are per batch-item (per
// product/variant), not a single number for the whole batch — a batch can
// bundle multiple products with different supplier MOQs (e.g. hoodie MOQ 24,
// tote bag MOQ 10 in the same drop). FR-004 ("ordered qty vs MOQ") is
// therefore a per-line-item comparison in the batch screen, not one
// batch-wide number.
// Same "public read, staff-only write" shape as batches — line items are
// created as part of the same AdminBatchesPage form submission.
export const batchItems = pgTable(
  "batch_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    moq: integer("moq"), // §10.1, §10.3 — informational only, never enforced
    // Admin's own memo of what they decided to order from the supplier for
    // this line (§10.1 "quantity actually ordered from supplier"). Purely
    // informational, set manually by admin — NOT auto-updated when receipts
    // are recorded. "How much has actually arrived so far" is derived from
    // inventory_transactions / on-hand, not tracked as a second counter here.
    procuredQuantity: integer("procured_quantity"),
  },
  (_table) => [
    pgPolicy("anyone_can_read_batch_items", { for: "select", to: ["anon", "authenticated"], using: sql`true` }),
    pgPolicy("staff_can_manage_batch_items", {
      for: "all",
      to: "authenticated",
      using: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
      withCheck: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
    }),
  ]
).enableRLS();

// §16, §27 — guest order access via direct supabase-js read (no login).
// PostgREST exposes the raw request headers as a JSON GUC; this pulls out a
// token the client sends on every direct read (src/lib/supabaseClient.ts).
// Matching it against orders.access_token *inside the policy* is what makes
// this a real security boundary — RLS `using` applies to every query
// regardless of what WHERE clause the client's own code adds, so a client
// can't just omit a filter and read every order.
//
// Milestone 5: the raw token the client sends is hashed here (SHA-256, via
// pgcrypto's digest()) before comparing — orders.access_token now stores
// that hash, never the raw value (§16.1, §27 "stored hashed in the
// database"). Same hash algorithm/encoding used everywhere this token is
// checked (this policy, resubmit-payment, submit-balance-payment) so a
// value hashed one way always matches a value hashed the other way.
const requestAccessToken = sql`encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')`;

// Separate counters per fulfilment method so order numbers read as
// "#010001" (pickup) / "#020001" (shipping) — sequential within each type,
// not a shared global counter. The 01/02 type prefix is derived from
// fulfilmentMethod at display time (src/lib/utils.ts formatOrderNumber),
// not stored — avoids keeping a redundant, potentially-stale copy of data
// orders.fulfilmentMethod already holds.
export const pickupOrderSeq = pgSequence("pickup_order_seq", { startWith: 1 });
export const shippingOrderSeq = pgSequence("shipping_order_seq", { startWith: 1 });

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    salesMode: salesModeEnum("sales_mode").notNull(),
    batchId: uuid("batch_id").references(() => batches.id), // required for pre-orders only
    status: orderStatusEnum("status").notNull().default("PAYMENT_PENDING"),
    paymentType: paymentTypeEnum("payment_type").notNull(),
    fulfilmentMethod: fulfilmentMethodEnum("fulfilment_method"),
    // Human-readable sequence number within its fulfilment type (see the
    // two sequences above). Nullable because fulfilmentMethod itself can be
    // "configured later" (§7.2) — an order without a fulfilment method yet
    // has no type-scoped sequence to draw from either.
    orderNumber: integer("order_number"),
    // Stamped the instant a pre-order enters RESERVED (i.e. right after its
    // initial payment is verified) — NOT when the order was created. §26's
    // MOQ-shortfall rule ranks by *payment-verification* time, not
    // order-submission time, so this needs its own column rather than
    // reusing createdAt. Ready-stock orders get this stamped too (harmless,
    // just unused — they never wait in AWAITING_STOCK).
    reservedAt: timestamp("reserved_at"),
    merchandiseSubtotal: numeric("merchandise_subtotal", {
      precision: 12,
      scale: 2,
    }).notNull(),
    shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    submissionToken: text("submission_token").notNull().unique(), // §19 duplicate-submission protection
    // Milestone 5 (§16.1, §27): stores encode(digest(raw, 'sha256'), 'hex')
    // — the raw token is never written here. Verifying "is this the right
    // customer" only ever needs a one-way check (hash what they sent,
    // compare), so a plain hash is the correct tool for this column.
    accessToken: text("access_token").notNull().unique(),
    // Milestone 5: a *separately* reversible copy of the same raw token
    // (pgcrypto pgp_sym_encrypt, keyed by the ACCESS_TOKEN_ENC_KEY Edge
    // Function secret — see supabase/functions/_shared/tokens.ts), stored
    // as base64 text. This exists for exactly one reason: the email worker
    // sends the *same* order-page link across up to 4 separate emails over
    // an order's lifetime, and a one-way hash alone makes that
    // impossible — nothing, including our own system, can turn a SHA-256
    // hash back into the raw value. A plain hash still fully protects the
    // everyday "is this the right customer" check above (that check never
    // needs the raw value back); this column is the one narrow exception,
    // usable only by code holding the encryption key (the email worker),
    // not by anything reading the database directly.
    accessTokenEncrypted: text("access_token_encrypted"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order", {
      for: "select",
      to: "anon",
      using: sql`${table.accessToken} = ${requestAccessToken}`,
    }),
    // Milestone 4 — fixes a real bug: AdminBatchesPage reads this table
    // directly (for FR-004 "ordered qty vs MOQ") using the plain browser
    // client, but until now there was no policy granting staff access at
    // all, so every such read silently returned zero rows. Any admin can
    // read (no specific §18.4 permission — matches "dashboard is read-only
    // for everyone regardless of permissions", §18.4); writes are unaffected
    // and still go through Edge Functions only.
    pgPolicy("staff_can_read_all_orders", {
      for: "select",
      to: "authenticated",
      using: isAnyAdmin,
    }),
  ]
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order_items", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
    // Same fix and same reasoning as staff_can_read_all_orders above —
    // AdminBatchesPage joins order_items to orders for the same FR-004 read.
    pgPolicy("staff_can_read_all_order_items", {
      for: "select",
      to: "authenticated",
      using: isAnyAdmin,
    }),
  ]
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    proofFileUrl: text("proof_file_url").notNull(), // §7.2 (v1.3) — required, not optional; §8, §19 retained 30 days post-completion
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    verifiedBy: uuid("verified_by").references(() => adminUsers.id),
    verifiedAt: timestamp("verified_at"),
    rejectionReason: text("rejection_reason"),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order_payments", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
  ]
).enableRLS();

// Milestone 4: RLS enabled — previously none at all (same open-write hole as
// products/batches above). Unlike those, there's no public/anon storefront
// read of this table, so SELECT is staff-only too (not just writes) — any
// admin can view current stock (§18.4 dashboard-read-only-for-everyone), but
// only canManageProductsBatches (new-variant zero-stock row on product
// creation, AdminProductsPage) or canAdjustInventory (actual stock changes)
// may INSERT. No authenticated UPDATE/DELETE policy is added: every real
// quantity change (record-batch-receipt, verify-payment's reservation
// allocation) already goes through an Edge Function on the service-role
// connection, which bypasses RLS regardless of what's defined here.
export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id)
      .unique(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    // available = onHand - reserved, computed at query time, not stored
  },
  (_table) => [
    pgPolicy("staff_can_read_inventory", { for: "select", to: "authenticated", using: isAnyAdmin }),
    pgPolicy("staff_can_create_inventory_rows", {
      for: "insert",
      to: "authenticated",
      withCheck: sql`exists (
        select 1 from ${adminUsers}
        where ${adminUsers.email} = ${requestAdminEmail}
          and (${adminUsers.canManageProductsBatches} = true or ${adminUsers.canAdjustInventory} = true)
      )`,
    }),
  ]
).enableRLS();

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  quantityDelta: integer("quantity_delta").notNull(), // +receipt, -reservation/adjustment
  reason: text("reason").notNull(), // required, §11.2
  createdBy: uuid("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id)
      .unique(),
    courier: text("courier").notNull().default("JNE"),
    service: text("service"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    address: text("address").notNull(),
    // Milestone 3: api.co.id's rate endpoint is district-code based (§15.1/
    // §15.2), not a free-text address — these are what create-order's
    // server-side rate re-verification actually calls the API with.
    // destinationDistrictName is stored purely for human display (order
    // page, admin screen, and the future shipping label) — the code is
    // what the shipping service itself uses.
    destinationDistrictCode: text("destination_district_code").notNull(),
    destinationDistrictName: text("destination_district_name").notNull(),
    // Snapshot of the computed order weight (grams) at the time this
    // shipment was created — product_variants.weightGrams could change
    // later; the rate that was actually quoted/charged should stay
    // reconstructable from this row rather than drifting with future edits.
    weightGrams: integer("weight_grams").notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    costOverrideReason: text("cost_override_reason"), // §26 audited override
    trackingNumber: text("tracking_number"),
  },
  (table) => [
    // Guest order page needs to show courier/service/tracking (§16) — same
    // access-token-matched pattern as orders/order_items/payments/pickup_tokens.
    // This table previously had no RLS at all, which (unlike the deliberately
    // deferred inventory/batches gap noted in architecture.md) is a real hole
    // worth closing now: it holds a customer's recipient name/phone/address.
    pgPolicy("guest_can_read_own_shipment", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
  ]
).enableRLS();

export const pickupTokens = pgTable(
  "pickup_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id)
      .unique(),
    token: text("token").notNull().unique(), // random, unguessable, §13.3
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_pickup_token", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
  ]
).enableRLS();

// Milestone 5: RLS enabled with no policies — same deny-all posture as
// customers (holds toAddress, real customer PII). Nothing reads or writes
// this table directly today (queuing happens inside Edge Function
// transactions on the service-role connection, which bypasses RLS
// regardless), but this table had no RLS at all before now, which is the
// same kind of gap products/batches/inventory had before Milestone 4 closed
// it — closing it here rather than leaving it for whoever builds the first
// direct read of this table later.
export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  toAddress: text("to_address").notNull(),
  template: text("template").notNull(),
  priority: emailPriorityEnum("priority").notNull(),
  status: emailStatusEnum("status").notNull().default("QUEUED"),
  queuedAt: timestamp("queued_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
}).enableRLS();

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => adminUsers.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


