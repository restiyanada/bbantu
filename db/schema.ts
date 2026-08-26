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

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(), // e.g. size/design
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
});

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

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  openAt: timestamp("open_at").notNull(),
  closeAt: timestamp("close_at").notNull(),
  moq: integer("moq"),
  procuredQuantity: integer("procured_quantity"),
  status: batchStatusEnum("status").notNull().default("DRAFT"),
  allowedPaymentTypes: paymentTypeEnum("allowed_payment_types").array().notNull(), // §10.1
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const batchItems = pgTable("batch_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => batches.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
});

// §16, §27 — guest order access via direct supabase-js read (no login).
// PostgREST exposes the raw request headers as a JSON GUC; this pulls out a
// token the client sends on every direct read (src/lib/supabaseClient.ts).
// Matching it against orders.access_token *inside the policy* is what makes
// this a real security boundary — RLS `using` applies to every query
// regardless of what WHERE clause the client's own code adds, so a client
// can't just omit a filter and read every order.
const requestAccessToken = sql`(current_setting('request.headers', true)::json ->> 'x-order-access-token')`;

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
    merchandiseSubtotal: numeric("merchandise_subtotal", {
      precision: 12,
      scale: 2,
    }).notNull(),
    shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    submissionToken: text("submission_token").notNull().unique(), // §19 duplicate-submission protection
    accessToken: text("access_token").notNull().unique(), // §16, §27 guest order access
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order", {
      for: "select",
      to: "anon",
      using: sql`${table.accessToken} = ${requestAccessToken}`,
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

export const inventory = pgTable("inventory", {
  id: uuid("id").primaryKey().defaultRandom(),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id)
    .unique(),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  // available = onHand - reserved, computed at query time, not stored
});

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

export const shipments = pgTable("shipments", {
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
  cost: numeric("cost", { precision: 12, scale: 2 }),
  costOverrideReason: text("cost_override_reason"), // §26 audited override
  trackingNumber: text("tracking_number"),
});

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

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  toAddress: text("to_address").notNull(),
  template: text("template").notNull(),
  priority: emailPriorityEnum("priority").notNull(),
  status: emailStatusEnum("status").notNull().default("QUEUED"),
  queuedAt: timestamp("queued_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
});

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

// RLS enabled with no policies — same reasoning as customers above. Staff
// identity/permissions are only ever touched via the service role connection.
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // NOTE: architecture.md specifies magic-link auth (Supabase Auth), which
  // doesn't need a password at all. Flagging this mismatch rather than
  // silently resolving it — leave for Milestone 4 to decide (drop this
  // column, or keep it for a fallback auth method) when auth is actually wired up.
  passwordHash: text("password_hash").notNull(),
  canVerifyPayments: boolean("can_verify_payments").notNull().default(false),
  canScanConfirmPickup: boolean("can_scan_confirm_pickup")
    .notNull()
    .default(false),
  canManageProductsBatches: boolean("can_manage_products_batches")
    .notNull()
    .default(false),
  canAdjustInventory: boolean("can_adjust_inventory").notNull().default(false),
  canManageShipping: boolean("can_manage_shipping").notNull().default(false),
  canViewAuditLog: boolean("can_view_audit_log").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();
