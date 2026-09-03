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