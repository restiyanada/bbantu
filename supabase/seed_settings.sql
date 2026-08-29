-- Configuration rows the app needs before it can take a real order.
--
-- Both tables hold exactly one row and are edited by hand — there is no admin
-- UI for either. Run this in the Supabase SQL console, which connects as
-- `postgres` and bypasses RLS. It will NOT work from the browser or an
-- anon-key client: `payment_settings` has a public SELECT policy but no write
-- policy, and `shipping_settings` has no policies at all (migration 0008).
-- That is deliberate — see below.
--
-- ⚠️ THE VALUES BELOW ARE PLACEHOLDERS. Replace them before taking real orders.
--
-- Nothing validates them. `payment_settings` is rendered verbatim at checkout
-- as the account customers are told to transfer to, so a placeholder account
-- number doesn't fail loudly — it quietly sends every customer's money to an
-- account that isn't yours, and the orders still arrive looking normal. This
-- is the same failure the RLS fix in 0008 was protecting against (an attacker
-- swapping the account), just arriving through the front door. `sender_phone`
-- is printed on shipping labels, so a wrong one leaves the courier unable to
-- reach you.
--
-- While the real values are still undecided, prefer an obviously-fake
-- placeholder over a plausible one — '[DO NOT TRANSFER]' is safer than
-- '1234567890', which reads like a real account to anyone who lands on
-- checkout.

-- ─────────────────────────────────────────────────────────────────────────────
-- Bank details shown at checkout (§7.2)
-- ─────────────────────────────────────────────────────────────────────────────
-- account_holder_name must match the account exactly, or customers' transfers
-- get held up by their own bank.

INSERT INTO payment_settings (bank_name, account_number, account_holder_name)
SELECT '[NOT CONFIGURED]', '[DO NOT TRANSFER]', '[PLACEHOLDER]'
WHERE NOT EXISTS (SELECT 1 FROM payment_settings);

-- Once decided, edit in place (no WHERE — the table holds one row):
--
--   UPDATE payment_settings
--   SET bank_name           = 'BCA',
--       account_number      = '<your real account number>',
--       account_holder_name = '<name exactly as it appears on the account>',
--       updated_at          = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Shipping origin + sender block (§15)
-- ─────────────────────────────────────────────────────────────────────────────
-- origin_district_code must be a real JNE district code — it's the origin for
-- every rate quote, so a wrong one produces wrong prices rather than an error.
-- Get valid codes from the shipping-locations Edge Function.

INSERT INTO shipping_settings (origin_district_code, origin_district_name, origin_address, sender_name, sender_phone)
SELECT '[JNE district code]', '[Origin district, city, province]', '[Street address]',
       '[Your shop name]', '[Your phone number]'
WHERE NOT EXISTS (SELECT 1 FROM shipping_settings);

-- Once decided:
--
--   UPDATE shipping_settings
--   SET sender_name  = 'Resti Shop',
--       sender_phone = '08123456789',   -- full number; Indonesian mobiles are ~10-13 digits
--       updated_at   = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify — run these ONE AT A TIME
-- ─────────────────────────────────────────────────────────────────────────────
-- The Supabase SQL editor only displays the last statement's result, so running
-- both together silently hides the first.
--
--   SELECT bank_name, account_number, account_holder_name FROM payment_settings;
--   SELECT origin_district_name, sender_name, sender_phone FROM shipping_settings;
--
-- Each must return exactly one row. Empty payment_settings makes checkout say
-- "Bank account details aren't configured yet — contact us before paying";
-- empty shipping_settings makes rate quotes fail with "Shipping isn't
-- configured yet — please choose pickup instead".
--
-- Then read the bank details back on the real checkout page and check them
-- against your banking app. That's the cheapest catch for a wrong account
-- number, and the only one that tests what the customer actually sees.

-- Safe to re-run: the inserts are guarded, so they seed only when the table is
-- empty and never overwrite values you've already set.
