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
-- ⚠️ No real admin auth exists yet (Milestone 4), so — same accepted,
-- clearly-flagged interim hole as products/batches having no RLS at all —
-- upload is open to the `anon` key for now. Tighten this to an authenticated
-- staff check once Milestone 4 lands.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy "anon_can_upload_product_image"
on storage.objects for insert
to anon
with check (bucket_id = 'product-images');

create policy "anyone_can_read_product_image"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');
