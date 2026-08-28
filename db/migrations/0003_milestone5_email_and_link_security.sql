-- Milestone 5: required by digest() (RLS policies below) and
-- pgp_sym_encrypt()/pgp_sym_decrypt() (supabase/functions/_shared/tokens.ts).
-- Supabase projects typically already have this available, but this makes
-- it explicit rather than assumed.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;--> statement-breakpoint
ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "access_token_encrypted" text;--> statement-breakpoint
ALTER POLICY "guest_can_read_own_order_items" ON "order_items" TO anon USING (exists (select 1 from "orders" where "orders"."id" = "order_items"."order_id" and "orders"."access_token" = encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')));--> statement-breakpoint
ALTER POLICY "guest_can_read_own_order" ON "orders" TO anon USING ("orders"."access_token" = encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex'));--> statement-breakpoint
ALTER POLICY "guest_can_read_own_order_payments" ON "payments" TO anon USING (exists (select 1 from "orders" where "orders"."id" = "payments"."order_id" and "orders"."access_token" = encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')));--> statement-breakpoint
ALTER POLICY "guest_can_read_own_pickup_token" ON "pickup_tokens" TO anon USING (exists (select 1 from "orders" where "orders"."id" = "pickup_tokens"."order_id" and "orders"."access_token" = encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')));--> statement-breakpoint
ALTER POLICY "guest_can_read_own_shipment" ON "shipments" TO anon USING (exists (select 1 from "orders" where "orders"."id" = "shipments"."order_id" and "orders"."access_token" = encode(digest((current_setting('request.headers', true)::json ->> 'x-order-access-token'), 'sha256'), 'hex')));