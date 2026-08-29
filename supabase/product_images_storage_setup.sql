-- Product image storage (Milestone 2 — §12, "1 product = 1 image").
--
-- Run this once in the Supabase SQL console, same as
-- supabase/storage_setup.sql for payment proofs. Not drizzle-managed — same
-- reasoning as that file (Supabase treats the `storage` schema as
-- read-only/API-managed).
--
-- PUBLIC bucket, unlike payment-proofs: product photos aren't sensitive and
-- need to render directly in <img src="..."> on the public storefront
-- (HomePage.tsx) with no signed URL / service-role round trip.
--
-- Upload is staff-only, gated on the same §18.4 permission the Products screen
-- checks (`canManageProductsBatches`). This file used to grant upload to `anon`
-- as an explicitly-flagged interim hole, with a note to tighten it "once
-- Milestone 4 lands" — that has since been done live, and this file is now
-- reconciled against the live project (`lhvxjgbjjamwatsmxiyc`) so re-running it
-- on a fresh project reproduces the tightened policy rather than reopening the
-- hole. The `with check` below is the live definition verbatim.
--
-- Note it duplicates the admin_users lookup that db/schema.ts expresses via its
-- `requestAdminEmail` helper. Unavoidable: this policy lives on storage.objects,
-- which drizzle deliberately doesn't manage, so it can't share that helper. If
-- the permission model changes, this file has to be updated by hand alongside
-- schema.ts — there is no tooling that will catch the drift.
--
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "anon_can_upload_product_image" on storage.objects;
drop policy if exists "staff_can_upload_product_image" on storage.objects;
create policy "staff_can_upload_product_image"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from admin_users
    where admin_users.email = (auth.jwt() ->> 'email')
      and admin_users.can_manage_products_batches = true
  )
);

drop policy if exists "anyone_can_read_product_image" on storage.objects;
create policy "anyone_can_read_product_image"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');
