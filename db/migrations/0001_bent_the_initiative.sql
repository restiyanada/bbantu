CREATE TABLE "shipping_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_district_code" text NOT NULL,
	"origin_district_name" text NOT NULL,
	"origin_address" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_items" ADD COLUMN "moq" integer;--> statement-breakpoint
ALTER TABLE "batch_items" ADD COLUMN "procured_quantity" integer;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "allowed_fulfilment_methods" "fulfilment_method"[] NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reserved_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "destination_district_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "destination_district_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "weight_grams" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" DROP COLUMN "moq";--> statement-breakpoint
ALTER TABLE "batches" DROP COLUMN "procured_quantity";--> statement-breakpoint
CREATE POLICY "guest_can_read_own_shipment" ON "shipments" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "orders" where "orders"."id" = "shipments"."order_id" and "orders"."access_token" = (current_setting('request.headers', true)::json ->> 'x-order-access-token')));