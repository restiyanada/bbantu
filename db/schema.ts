import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  pgPolicy,
  pgSequence,
  index,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

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

const requestAdminEmail = sql`(auth.jwt() ->> 'email')`;

const isAnyAdmin = sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail})`;

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
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

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
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

// Photos for one product, ordered. sort_order 0 is the cover — it is mirrored
// into products.image_url so the storefront grid, order tracker thumbnails and
// shipping labels keep working off a single column.
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("product_images_product_idx").on(table.productId, table.sortOrder),
    pgPolicy("anyone_can_read_product_images", { for: "select", to: ["anon", "authenticated"], using: sql`true` }),
    pgPolicy("staff_can_manage_product_images", {
      for: "all",
      to: "authenticated",
      using: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
      withCheck: sql`exists (select 1 from ${adminUsers} where ${adminUsers.email} = ${requestAdminEmail} and ${adminUsers.canManageProductsBatches} = true)`,
    }),
  ]
).enableRLS();

// Read straight from the browser at checkout (HomePage) so the customer knows
// which account to transfer to — hence the public select policy. There is
// deliberately no insert/update/delete policy: with RLS on, that makes the row
// service-role-only to write. Without RLS this table was anon-writable, which
// would let anyone swap in their own bank account number and silently collect
// every customer's payment.
export const paymentSettings = pgTable(
  "payment_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    accountHolderName: text("account_holder_name").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (_table) => [
    pgPolicy("anyone_can_read_payment_settings", {
      for: "select",
      to: ["anon", "authenticated"],
      using: sql`true`,
    }),
  ]
).enableRLS();

// No policies at all — deny-all for anon/authenticated. Only ever read by Edge
// Functions (shipping-rates, create-order, shipping-label-info) over the
// service-role connection, which bypasses RLS. Nothing in the browser touches it.
export const shippingSettings = pgTable("shipping_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  originDistrictCode: text("origin_district_code").notNull(),
  originDistrictName: text("origin_district_name").notNull(),
  originAddress: text("origin_address").notNull(),
  senderName: text("sender_name").notNull().default("[Your shop name]"),
  senderPhone: text("sender_phone").notNull().default("[Your phone number]"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    openAt: timestamp("open_at").notNull(),
    closeAt: timestamp("close_at").notNull(),
    status: batchStatusEnum("status").notNull().default("DRAFT"),
    allowedPaymentTypes: paymentTypeEnum("allowed_payment_types").array().notNull(),
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
    moq: integer("moq"),
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

const requestAccessToken = sql`encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')`;

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
    batchId: uuid("batch_id").references(() => batches.id),
    status: orderStatusEnum("status").notNull().default("PAYMENT_PENDING"),
    paymentType: paymentTypeEnum("payment_type").notNull(),
    fulfilmentMethod: fulfilmentMethodEnum("fulfilment_method"),
    orderNumber: integer("order_number"),
    reservedAt: timestamp("reserved_at"),
    merchandiseSubtotal: numeric("merchandise_subtotal", {
      precision: 12,
      scale: 2,
    }).notNull(),
    shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    submissionToken: text("submission_token").notNull().unique(),
    accessToken: text("access_token").notNull().unique(),
    accessTokenEncrypted: text("access_token_encrypted"),
    fulfilledAt: timestamp("fulfilled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order", {
      for: "select",
      to: "anon",
      using: sql`${table.accessToken} = ${requestAccessToken}`,
    }),
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
    // What the customer actually bought, captured at checkout beside the price.
    // Editing a product later must not rewrite the record of a past order, so
    // the tracker reads these rather than joining live through variant_id.
    productName: text("product_name"),
    variantName: text("variant_name"),
    imageUrls: jsonb("image_urls").$type<string[]>(),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order_items", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
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
    proofFileUrl: text("proof_file_url").notNull(),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    verifiedBy: uuid("verified_by").references(() => adminUsers.id),
    verifiedAt: timestamp("verified_at"),
    rejectionReason: text("rejection_reason"),
    proofDeletedAt: timestamp("proof_deleted_at"),
  },
  (table) => [
    pgPolicy("guest_can_read_own_order_payments", {
      for: "select",
      to: "anon",
      using: sql`exists (select 1 from ${orders} where ${orders.id} = ${table.orderId} and ${orders.accessToken} = ${requestAccessToken})`,
    }),
  ]
).enableRLS();

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

// No policies at all — deny-all for anon/authenticated, same as audit_logs.
// This is a stock-movement ledger written only by Edge Functions over the
// service-role connection; nothing reads it from the browser.
export const inventoryTransactions = pgTable("inventory_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  quantityDelta: integer("quantity_delta").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();

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
    destinationDistrictCode: text("destination_district_code").notNull(),
    destinationDistrictName: text("destination_district_name").notNull(),
    weightGrams: integer("weight_grams").notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    costOverrideReason: text("cost_override_reason"),
    trackingNumber: text("tracking_number"),
  },
  (table) => [
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
    token: text("token").notNull().unique(),
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
}).enableRLS();

// Superseded by rateLimitAttempts below, which does the same job with an
// `endpoint` discriminator so several endpoints can be limited independently.
// Kept (unused) rather than dropped in the same change that introduced its
// replacement — dropping it is a separate, deliberate step once the new table
// is confirmed working live.
export const accessRecoveryAttempts = pgTable("access_recovery_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ipAddress: text("ip_address").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}).enableRLS();

// Per-IP request log backing the §16.1/§19 rate limits. One row per attempt;
// `endpoint` keeps each limited function's budget separate, so hammering the
// shipping quote endpoint can't lock a customer out of order recovery.
//
// No policies — deny-all for anon/authenticated. Only Edge Functions touch it,
// over the service-role connection.
//
// Rows are only meaningful for RATE_LIMIT_WINDOW_MS (60s); everything older is
// dead weight. See migration 0008's trailing note for the cleanup cron.
export const rateLimitAttempts = pgTable(
  "rate_limit_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull(),
    ipAddress: text("ip_address").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("rate_limit_attempts_lookup_idx").on(table.endpoint, table.ipAddress, table.createdAt)]
).enableRLS();

