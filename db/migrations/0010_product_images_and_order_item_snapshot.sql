-- Multiple photos per product, and a snapshot of what was sold.
--
-- ⚠️ Apply this BY HAND in the Supabase SQL editor. Do NOT use `drizzle-kit
--    push` — it silently drops policy USING conditions, which Postgres then
--    treats as deny-all. See README.md and ARCHITECTURE.md.
--
-- 1. `product_images` — one row per photo, ordered by sort_order. sort_order 0
--    is the cover, and the app mirrors that URL into products.image_url, so
--    the storefront grid, order-tracker thumbnails and shipping labels keep
--    reading a single column and need no change. Policies mirror `products`:
--    public SELECT (the storefront reads it directly with the anon key), and
--    manage restricted to staff holding can_manage_products_batches.
--
-- 2. Three nullable columns on `order_items` — product_name, variant_name and
--    image_urls. Until now an order item stored the price it was sold at but
--    followed variant_id live for the name and the photo, so editing a product
--    would have rewritten what every past order appears to contain. These
--    capture the item's identity at checkout, beside the price that was
--    already captured there.
--
--    They are nullable and NOT backfilled: existing rows keep NULL and the
--    tracker falls back to the live join for them, which is the behaviour
--    those orders already had. New orders get the snapshot. There is nothing
--    to backfill correctly for an order placed before the column existed —
--    nobody recorded which photos that customer saw.
--
-- Verify:
--   SELECT tablename, policyname, cmd, qual IS NULL AS no_using,
--          with_check IS NULL AS no_check
--     FROM pg_policies WHERE tablename = 'product_images';
--   -- 2 rows; no_using must be false on both (SELECT and ALL both use USING)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'order_items' ORDER BY ordinal_position;
--   -- must include product_name, variant_name, image_urls

CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_name" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "image_urls" jsonb;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE POLICY "anyone_can_read_product_images" ON "product_images" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "staff_can_manage_product_images" ON "product_images" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));