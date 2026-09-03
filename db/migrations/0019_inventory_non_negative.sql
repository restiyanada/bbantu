-- Journaled (schema.ts change). Floors on inventory.reserved and
-- inventory.on_hand: the cancellation feature's design accepts that a false
-- positive in releaseReservation (or any other bug that drives either
-- counter negative) would cause overselling, and nothing at the DB level
-- would stop or even surface one without this. releaseReservation issues an
-- unguarded `reserved = reserved - qty`, so a bug that releases more than
-- was actually held would otherwise sail through silently.
--
-- ⚠️ RUN THE PRE-CHECK FIRST. Adding a CHECK constraint to a table that
-- already violates it FAILS — safely, changing nothing, but the migration
-- will not apply until the offending rows are corrected:
--
--   SELECT variant_id, on_hand, reserved FROM inventory WHERE reserved < 0 OR on_hand < 0;
--   -- empty result = safe to apply
--
-- Verify after applying:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'inventory'::regclass
--     AND conname IN ('inventory_reserved_non_negative', 'inventory_on_hand_non_negative');

ALTER TABLE "inventory" ADD CONSTRAINT "inventory_reserved_non_negative" CHECK ("inventory"."reserved" >= 0);--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_on_hand_non_negative" CHECK ("inventory"."on_hand" >= 0);
