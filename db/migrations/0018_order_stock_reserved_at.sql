-- Journaled (schema.ts change). orders.stock_reserved_at is non-null iff
-- this order currently holds an inventory.reserved increment — the
-- invariant the whole cancellation feature is built on.
--
-- Why not reuse reserved_at: reserved_at is set even when allocation
-- FAILED (verify-payment's pre-order path, which sets it and then routes
-- the order to AWAITING_STOCK with nothing reserved) and is never set for
-- a ready-stock order that DOES hold a reservation (verify-payment's
-- ready-stock path only reaches RESERVED/READY_FOR_FULFILMENT after
-- tryAllocatePhysicalReservation succeeds). Releasing stock off
-- reserved_at would both miss real reservations and free stock that was
-- never taken — overselling either way. stock_reserved_at is set only at
-- the two places that actually increment inventory.reserved, and cleared
-- only when that increment is released.
ALTER TABLE "orders" ADD COLUMN "stock_reserved_at" timestamp;

-- Backfill: an order holds a reservation exactly when verify-payment (or
-- record-batch-receipt, promoting it off the waiting list) incremented
-- inventory.reserved for it and nothing has released it. Nothing releases it
-- today, so every order at or past READY_FOR_FULFILMENT still holds one, as
-- does every BALANCE_DUE order. AWAITING_STOCK orders never got one.
-- PICKED_UP/SHIPPED/COMPLETED keep it too — Stage 2 of the inventory work
-- releases those at fulfilment; this stage must not change their meaning.
UPDATE orders
SET stock_reserved_at = COALESCE(reserved_at, created_at)
WHERE status IN (
  'BALANCE_DUE', 'READY_FOR_FULFILMENT', 'READY_FOR_PICKUP',
  'READY_TO_SHIP', 'PICKED_UP', 'SHIPPED', 'COMPLETED'
);
