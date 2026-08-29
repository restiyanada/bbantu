-- Payment proof upload storage (§7.2, §8, §19).
--
-- Run this once in the Supabase SQL console. Not part of drizzle-kit's
-- schema management: Supabase's own docs say to treat the `storage` schema
-- as read-only/API-managed, not something an ORM should introspect or
-- migrate (https://supabase.com/docs/guides/storage/schema/design).
--
-- Private bucket — no public read. Customers can upload (write-only, no
-- select/list policy at all, so nobody can browse or guess their way into
-- someone else's proof — not even the customer who uploaded it). Only the
-- service-role connection (Edge Functions) or a signed URL can read a file
-- back — see list-orders and verify-payment.
--
-- Reconciled against the live project (`lhvxjgbjjamwatsmxiyc`) during the
-- pre-deploy review: the policy below now matches what is actually deployed,
-- name and roles included. It had drifted — live was
-- `anyone_can_upload_payment_proof` granted to {anon, authenticated}, while
-- this file still said `anon_can_upload_payment_proof` to anon only. Re-running
-- the old version on a fresh project would have produced a subtly different
-- setup from the one that's been exercised in production.
--
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5MB
  -- Images only — no PDF. Keeps the admin proof viewer a plain <img>, no
  -- PDF-vs-image branching or embedded-viewer fallback to build/maintain.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- INSERT-only, so there is no USING clause — `qual` is NULL for this policy in
-- pg_policies, which is correct and not the drizzle-kit RLS bug. A policy is
-- only broken if a non-INSERT one has a NULL qual, or an INSERT one has a NULL
-- with_check. See ARCHITECTURE.md.
--
-- `authenticated` is included alongside `anon` so a logged-in staff member
-- testing checkout in their own browser can upload too; the bucket check is
-- what actually scopes this, not the role.
drop policy if exists "anon_can_upload_payment_proof" on storage.objects;
drop policy if exists "anyone_can_upload_payment_proof" on storage.objects;
create policy "anyone_can_upload_payment_proof"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'payment-proofs');
