-- One-time backfill for orders.fulfilled_at (Milestone 6, item 31).
--
-- The column was added in 0005 and is stamped going forward at the two
-- fulfilment call sites (scan-pickup's PICKUP_CONFIRMED branch,
-- record-tracking's TRACKING_RECORDED). Orders that reached SHIPPED or
-- PICKED_UP *before* that deploy have fulfilled_at = NULL, and
-- cleanup-payment-proofs skips NULL outright
-- (lib/proof-retention.ts: `if (candidate.fulfilledAt === null) return false`).
-- Left unfixed, those payment proofs are retained forever instead of the 30
-- days §8/§19 requires — a privacy obligation quietly not being met, not just
-- untidy data.
--
-- milestone.md has carried this as "written, not yet run" since Milestone 6
-- handoff. This is that query, as a migration so it is applied once and its
-- reasoning is recorded, rather than pasted into the SQL editor from a note.
--
-- Derivation: audit_logs, not a guess. transitionOrder() (lib/orders.ts)
-- writes exactly one row per status change with the real timestamp, shaped
--   entity_type = 'order'
--   entity_id   = the order id
--   after_value = {"status": "<new status>"}   (jsonb)
-- so the moment of fulfilment is the earliest audit row whose after_value
-- status is SHIPPED or PICKED_UP. MIN() rather than the latest, because a
-- resubmitted-payment order can have several rows and the first crossing is
-- the one the retention clock should start from.
--
-- COMPLETED orders are included deliberately: the state machine only reaches
-- COMPLETED from PICKED_UP or SHIPPED (lib/order-state-machine.ts), so those
-- orders were fulfilled too and still carry the crossing row in their history.
-- Filtering on current status alone would have missed them.
--
-- Orders with no matching audit row are left NULL rather than guessed at from
-- created_at — a wrong timestamp here deletes a payment proof early, which is
-- not recoverable. NULL just means "never cleaned up", which is the safe
-- direction to fail.
--
-- Idempotent: the WHERE clause only touches rows still NULL, so re-running is
-- a no-op. Safe to apply with either `drizzle-kit migrate` or by hand — it
-- touches no RLS policy, so the push bug documented in ARCHITECTURE.md and in
-- 0008's header does not apply here.
--
-- To see what it will change before running it, swap UPDATE for a SELECT:
--
--   SELECT o.id, o.order_number, o.status, f.fulfilled_at
--   FROM orders o JOIN (
--     SELECT entity_id AS order_id, MIN(created_at) AS fulfilled_at
--     FROM audit_logs
--     WHERE entity_type = 'order'
--       AND after_value ->> 'status' IN ('PICKED_UP', 'SHIPPED')
--     GROUP BY entity_id
--   ) f ON f.order_id = o.id
--   WHERE o.fulfilled_at IS NULL;

UPDATE orders o
SET fulfilled_at = f.fulfilled_at
FROM (
  SELECT entity_id AS order_id, MIN(created_at) AS fulfilled_at
  FROM audit_logs
  WHERE entity_type = 'order'
    AND after_value ->> 'status' IN ('PICKED_UP', 'SHIPPED')
  GROUP BY entity_id
) f
WHERE o.id = f.order_id
  AND o.fulfilled_at IS NULL;
