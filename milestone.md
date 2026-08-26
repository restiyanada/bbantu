Milestone 1 — One order, start to finish (ready stock, full payment, pickup)

Backend (done):
1. lib/orders.ts + lib/audit.ts — transitionOrder() wraps the state machine in
   a real DB transaction (status change + audit row together, §20).
2. Seeded one product/variant/inventory row directly via SQL — still no
   admin UI for creating products yet (see step 8).
3. supabase/functions/create-order — guest order creation (§7). Ready stock +
   full payment + pickup only, to start. Computes merchandiseSubtotal
   server-side, never trusts a price from the browser.
4. supabase/functions/verify-payment — admin verifies/rejects payment
   (§8.3). For ready-stock+full, chains straight through to
   READY_FOR_FULFILMENT and allocates the inventory reservation. Uses a
   hardcoded admin id for now — Supabase Auth comes in Milestone 4.
5. supabase/functions/prepare-pickup + supabase/functions/scan-pickup —
   pickup QR token generation and validation (§13). scan-pickup is two-phase:
   look up first, confirm second, matching §13.2's explicit staff
   confirmation step.
6. src/pages/OrderPage.tsx — guest order status page, reading real data via
   supabase-js directly (not an Edge Function), gated by an RLS policy
   matching the order's access token (§16, §27).

All of the above verified end-to-end against the live Supabase project —
not just tested locally.

UI (done):

7. Customer checkout form (src/pages/HomePage.tsx) — browse the seeded
   product(s), enter name/phone/email, place the order. Calls create-order,
   then sends the customer to their own /orders/:accessToken page (already
   built in step 6). Payment proof upload is still not wired (Storage
   bucket + RLS don't exist yet) — open gap, not silently resolved.
8. Admin action screen (src/pages/AdminDashboardPage.tsx) — a real list of
   orders (via a new supabase/functions/list-orders, needed since the RLS
   policy on orders deliberately doesn't grant a "staff" role broader
   access yet) with buttons: "Verify Payment" / "Reject" (calls
   verify-payment), "Prepare for Pickup" (calls prepare-pickup). No real
   login yet (Milestone 4) — for internal testing only, not something to
   put a public link to.
9. Staff pickup scanner (src/pages/ScanPage.tsx) — opens the phone camera
   (qr-scanner npm package, §14), decodes the QR automatically, calls
   scan-pickup for lookup, shows the order details, then a "Confirm Pickup"
   button calls scan-pickup again with confirm. Manual code entry as a
   fallback if the camera doesn't work.

End of Milestone 1: a customer can place a real order by clicking through a
form, an admin can verify it and stage it for pickup by clicking buttons,
and staff can scan a real QR code with their phone camera to complete the
pickup — the whole loop works by hand, not just by curl. Not yet tested
against the live Supabase project (needs supabase functions deploy
list-orders, and real-camera testing in a browser) — see ARCHITECTURE.md.

Milestone 2 — Batches + partial payment (DP)

Backend:
10. Batch management: create/open/close, MOQ display (§10) — admin actions,
    permission-gated (canManageProductsBatches, wired for real in
    Milestone 4; for now, same no-login caveat as step 8).
11. Supplier stock receipt recording → resolves AWAITING_STOCK (§10.3, §11).
12. DP payment type + balance-due flow (§8.2, §9) — AWAITING_STOCK →
    BALANCE_DUE once stock arrives, if unpaid balance remains.

UI:
13. Admin batch screen — create a batch: name, open/close time, MOQ, which
    products/variants are sold in it (with picture + description — this is
    also the first real product-creation UI, replacing the manual SQL
    seeding from step 2), which payment types it allows (DP / FULL / both,
    §10.1), and which fulfilment methods it allows (pickup-only,
    shipping-only, or both — a batch-level restriction, not just a
    per-order customer choice).
14. Customer checkout form (extends step 7, not a new screen) — when
    ordering from an active batch, only shows the payment types and
    fulfilment methods that batch allows; adds the DP vs. FULL choice.
15. Customer balance payment — from their existing order page, a way to
    submit the remaining payment once BALANCE_DUE (reusing the same
    payment-submission pattern as the initial order, admin verifies through
    an extended version of verify-payment).

No email in this milestone, even though §17 marks balance-due as a P0
(never-delayed) email — building the full priority queue just for one email
type isn't worth it; every email, including this one, waits for Milestone 5.

Milestone 3 — Shipping

Backend:
16. Shipping address, cost calculation, label generation, tracking (§15).
    Label generation runs in an Edge Function (Deno) — may need a different
    PDF library than a typical Node-only package; confirm when we get here.

UI:
17. Customer checkout form (extends step 7/14 again, not a new screen) —
    adds the shipping vs. pickup choice and address fields, with cost shown
    before submitting.
18. Admin — enter tracking number, generate/print the shipping label.

Milestone 4 — Admin proper (real auth)

19. Admin auth: Supabase Auth (magic link) for staff login, replacing the
    hardcoded admin id used since Milestone 1. Per-action permission
    toggles from §18.4 (admin_users table, already in db/schema.ts) enforced
    for real.
20. The simple, no-login admin screens built ad hoc in Milestones 1–3 get
    replaced by a real dashboard (§18.1: payment queue, DP balances due,
    active batches, orders awaiting stock/pickup/shipping) — action buttons
    disabled (not hidden) per §18.4 when the logged-in staff member lacks
    that permission.

Milestone 5 — Email

21. Email queue table + worker + Resend, P0/P1/P2 priority (§17, §24) —
    covers every email type at once, including the balance-due email
    deferred from Milestone 2. Worker is a scheduled Edge Function
    (Supabase's cron/scheduled functions support) — exact setup to confirm
    when we get here.

Milestone 6 — Remaining edge cases

22. Order access recovery via phone+email (§16, §27) — Edge Function, since
    matching phone+email isn't a simple RLS row match.
23. Payment proof 30-day retention cleanup (§8) — scheduled Edge Function,
    deletes from Supabase Storage.
24. Audit log viewer in admin UI — direct Supabase read gated by RLS
    (canViewAuditLog), same pattern as other admin dashboard reads.
