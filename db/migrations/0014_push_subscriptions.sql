-- Web Push subscriptions (§17a). One row per browser subscription: ADMIN rows
-- notify staff of new orders and payment submissions, CUSTOMER rows notify
-- whoever placed one specific order about its status. Written only by the
-- push-subscribe/push-unsubscribe Edge Functions over the service-role
-- connection — no RLS policies, deny-all for anon/authenticated, same as
-- inventory_transactions and shipping_settings.
--
-- The CHECK constraint keeps a row from ever pointing at both an admin and an
-- order (or neither) — the kind column and the owning FK must agree.

CREATE TYPE "public"."push_subscriber_kind" AS ENUM('ADMIN', 'CUSTOMER');--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "push_subscriber_kind" NOT NULL,
	"admin_id" uuid,
	"order_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_kind_matches_owner" CHECK (("push_subscriptions"."kind" = 'ADMIN' and "push_subscriptions"."admin_id" is not null and "push_subscriptions"."order_id" is null)
        or ("push_subscriptions"."kind" = 'CUSTOMER' and "push_subscriptions"."order_id" is not null and "push_subscriptions"."admin_id" is null))
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_admin_idx" ON "push_subscriptions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_order_idx" ON "push_subscriptions" USING btree ("order_id");
