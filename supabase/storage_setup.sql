-- Payment proof upload storage (§7.2, §8, §19).
--
-- Run this once in the Supabase SQL console. Not part of drizzle-kit's
-- schema management: Supabase's own docs say to treat the `storage` schema
-- as read-only/API-managed, not something an ORM should introspect or
-- migrate (https://supabase.com/docs/guides/storage/schema/design).
--
-- Private bucket — no public read. Customers can upload (write-only, no
-- select/list policy at all for anon, so nobody can browse or guess their
-- way into someone else's proof). Only the service-role connection (Edge
-- Functions) or a signed URL can read a file back — see list-orders and
-- verify-payment.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

create policy "anon_can_upload_payment_proof"
on storage.objects for insert
to anon
with check (bucket_id = 'payment-proofs');
