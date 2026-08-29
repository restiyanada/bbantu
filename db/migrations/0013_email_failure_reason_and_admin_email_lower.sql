-- Two unrelated changes, bundled because drizzle-kit generate emitted them
-- together against the current schema.ts.
--
-- 1. emails.failure_reason — a FAILED row said nothing about why. The real
--    reason (a Resend error, a bad API key, an unverified sending domain)
--    only ever existed in send-queued-emails' console.error, invisible
--    without digging through Supabase's Edge Function logs. Now persisted, so
--    `SELECT template, status, failure_reason FROM emails` is enough on its
--    own to diagnose a stuck send.
--
-- 2. The ALTER POLICY statements are catching up migration history to schema.ts,
--    not a live behavior change. The `lower()` fix for admin_users' case
--    sensitivity (migration 0012) was added to schema.ts's shared
--    `requestAdminEmail` constant, which every one of these policies already
--    interpolates — but 0012 was hand-written (it's a trigger, which
--    drizzle-kit can't generate) and never ran `drizzle-kit generate`
--    afterward, so none of these policies' actual SQL picked it up. It didn't
--    matter functionally: 0012's trigger keeps admin_users.email lowercase at
--    the source, and the JWT side is already lowercase from Supabase Auth, so
--    every one of these comparisons already matched correctly without this.
--    This just makes each policy's own text match what schema.ts has said all
--    along, so the next `generate` doesn't produce a confusing diff against
--    itself.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'emails' AND column_name = 'failure_reason';
--   -- 1 row
--
--   SELECT policyname, qual LIKE '%lower(%' AS has_lower
--     FROM pg_policies
--    WHERE qual LIKE '%admin_users%';
--   -- has_lower must be true on every row (Postgres reformats the expression
--   -- to lower((auth.jwt() ->> 'email'::text)) — the extra paren is why the
--   -- pattern is just '%lower(%', not the literal source text)

ALTER TABLE "emails" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER POLICY "admin_can_read_own_row" ON "admin_users" TO authenticated USING ("admin_users"."email" = lower(auth.jwt() ->> 'email'));--> statement-breakpoint
ALTER POLICY "staff_can_manage_batch_items" ON "batch_items" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
ALTER POLICY "staff_can_manage_batches" ON "batches" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
ALTER POLICY "staff_can_read_inventory" ON "inventory" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email')));--> statement-breakpoint
ALTER POLICY "staff_can_create_inventory_rows" ON "inventory" TO authenticated WITH CHECK (exists (
        select 1 from "admin_users"
        where "admin_users"."email" = lower(auth.jwt() ->> 'email')
          and ("admin_users"."can_manage_products_batches" = true or "admin_users"."can_adjust_inventory" = true)
      ));--> statement-breakpoint
ALTER POLICY "staff_can_read_all_order_items" ON "order_items" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email')));--> statement-breakpoint
ALTER POLICY "staff_can_read_all_orders" ON "orders" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email')));--> statement-breakpoint
ALTER POLICY "staff_can_manage_product_images" ON "product_images" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
ALTER POLICY "staff_can_manage_product_variants" ON "product_variants" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
ALTER POLICY "staff_can_manage_products" ON "products" TO authenticated USING (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = lower(auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));
