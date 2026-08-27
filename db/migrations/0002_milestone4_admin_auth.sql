ALTER TABLE "batch_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "password_hash";--> statement-breakpoint
CREATE POLICY "anyone_can_read_batch_items" ON "batch_items" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "staff_can_manage_batch_items" ON "batch_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
CREATE POLICY "anyone_can_read_batches" ON "batches" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "staff_can_manage_batches" ON "batches" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
CREATE POLICY "staff_can_read_inventory" ON "inventory" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email')));--> statement-breakpoint
CREATE POLICY "staff_can_create_inventory_rows" ON "inventory" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (
        select 1 from "admin_users"
        where "admin_users"."email" = (auth.jwt() ->> 'email')
          and ("admin_users"."can_manage_products_batches" = true or "admin_users"."can_adjust_inventory" = true)
      ));--> statement-breakpoint
CREATE POLICY "staff_can_read_all_order_items" ON "order_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email')));--> statement-breakpoint
CREATE POLICY "staff_can_read_all_orders" ON "orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email')));--> statement-breakpoint
CREATE POLICY "anyone_can_read_product_variants" ON "product_variants" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "staff_can_manage_product_variants" ON "product_variants" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));--> statement-breakpoint
CREATE POLICY "anyone_can_read_products" ON "products" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "staff_can_manage_products" ON "products" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true)) WITH CHECK (exists (select 1 from "admin_users" where "admin_users"."email" = (auth.jwt() ->> 'email') and "admin_users"."can_manage_products_batches" = true));