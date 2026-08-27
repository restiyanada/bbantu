PRD revised to v1.3 (PRD.html) — $0 infrastructure track: simplified email
model, Web Push added, stricter token/rate-limiting requirements. Section
numbers didn't change (§17a inserted as a lettered sub-section), so every
reference below is still accurate. Two things from v1.3 need attention
before/alongside the milestones they touch:

⚠️ **Access token storage (§16.1) conflicts with what's already built.**
v1.3 requires the order access token be "stored hashed in the database."
What Milestone 1 actually built and verified live stores it in plaintext and
compares it directly inside the RLS policy (`access_token = header_value`)
— that's the entire mechanism `OrderPage.tsx`'s guest read relies on.
Hashing it means the RLS policy can no longer do a plain `=`; it would need
either a Postgres-side hash function call inside the policy expression, or
giving up the direct-RLS-read pattern for an Edge-Function-mediated lookup
instead. Not resolved here — a real design decision, not a find-and-replace,
and changing it means re-verifying the whole guest-read flow again. Revisit
deliberately, not as a side effect of some other milestone.

**Payment proof is now required at order creation (§7.2), not optional.**
✅ Resolved (see Milestone 1's "Payment proof upload" section below) — Storage
bucket, upload, existence verification, resubmission after rejection, and
admin proof viewing are all built. Customer-facing wording (order summary,
DP explanation, upload instructions) is functional English for now —
localization/final copy is a deliberately separate task, not blocking.

Also new in v1.3, not yet reflected below in detail: rate limiting on the
order-access endpoint (10 req/min/IP, §16.1/§19) — not built anywhere yet,
noted for whichever milestone ends up hardening security holistically.

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
   built in step 6). Validates name (letters only) and phone (8–15 digits)
   both client-side and server-side. Payment proof upload is now wired —
   see "Payment proof upload" below.
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
   fallback if the camera doesn't work, plus a phone-number search fallback
   (finds READY_FOR_PICKUP orders for that number so staff can pick the
   right one by name — phone alone never confirms a pickup directly, §27).

Polish (done, after user feedback on the built UI):
10. Sequential, human-readable order numbers (#010001-style, 01/02 encoding
    fulfilment type) instead of raw UUIDs — a real schema change (two
    Postgres sequences + an order_number column), not just a display tweak.
11. Pickup codes shortened from a full UUID to 6 characters (unambiguous
    alphabet), easier to type as the manual fallback.
12. Status colors — Badge/Button extended with warning/info/success
    variants; all 12 order statuses now map to a meaningful color instead
    of 3 flat tones.

Payment proof upload (done, per PRD v1.3's §7.2 requirement):
13. supabase/storage_setup.sql — private `payment-proofs` Storage bucket,
    set up directly via SQL console (not drizzle-managed — Supabase's own
    docs say to treat the storage schema as read-only/API-managed).
    Write-only for guests (no select/list policy for anon at all — proof
    files aren't readable by anyone except service-role/signed URL, not
    even the customer who uploaded it), 5MB limit, image/PDF only. Upload
    paths are keyed by submissionToken rather than order id, since the
    order doesn't exist yet when the proof is uploaded (§7.2 wants them as
    one atomic flow).
14. create-order now requires proofFileUrl and verifies the path actually
    exists in storage.objects before creating the order — a claimed-but-
    fake path is rejected, not trusted. New supabase/functions/
    resubmit-payment — customer re-uploads after a rejected payment (§26),
    ownership verified via access token (order id alone isn't secret).
15. Checkout (src/pages/HomePage.tsx) now shows an order summary before the
    upload step: total, payment instructions (written to branch on DP vs.
    FULL now, even though only FULL is reachable until Milestone 2 turns DP
    on), and bank account details from a new payment_settings table —
    single global row for now, admin-edited via SQL console; per-batch
    config is Milestone 2's job, once batches exist to attach it to. Admin
    (src/pages/AdminDashboardPage.tsx) can now view the uploaded proof via
    a signed URL (list-orders, using a service-role supabase-js client
    alongside its existing direct-Postgres connection) before verifying.

End of Milestone 1: a customer can place a real order — with payment proof
— by clicking through a form, an admin can review that proof and verify or
reject it, stage the order for pickup, and staff can scan a real QR code
with their phone camera to complete the pickup. A rejected payment can be
resubmitted with a new proof, without starting a new order. Verified for
real: camera permission prompt confirmed working (tested with the camera
physically off, which is why the preview showed the browser's own
"no signal" icon — expected, not a bug), and both the customer order page
and admin dashboard correctly reflected PICKED_UP afterward. Backend, UI,
and every round of polish/feedback are all done and pushed. Payment proof
upload itself hasn't yet been re-verified against the live Supabase project
the way the rest of Milestone 1 was — needs supabase functions deploy
resubmit-payment (new) plus redeploying create-order/list-orders, running
supabase/storage_setup.sql, and seeding one payment_settings row before
testing end to end.

Milestone 2 — Batches + partial payment (DP) — DONE, pending live verification

Four decisions corrected the plan below before any of it was built (chat
carried over from Milestone 1):

- **Products screen is standalone**, not folded into batch creation as step
  19 originally had it. `src/pages/AdminProductsPage.tsx` creates
  products+variants+images independent of any batch; the batch screen only
  picks from what already exists there. Lets a product be reused across
  batches, or exist as ready stock with no batch at all.
- **One image per product**, not per variant/color. A product with two
  colors is two separate products, each with its own photo — `imageUrl`
  lives on `products`, not `product_variants`. Uploaded to a new *public*
  Storage bucket (`supabase/product_images_storage_setup.sql`), unlike the
  private payment-proofs bucket.
- **MOQ moved from `batches` to `batch_items`** — it's per product/variant,
  not one number for the whole batch (a batch can bundle a hoodie at MOQ 24
  and a tote bag at MOQ 10). `procuredQuantity` moved with it, and stays
  purely informational (§10.3), never auto-updated by receipts.
- **No "publish surplus" approval gate** (§12's previously-open question,
  §33 item 10) — surplus from a receipt is sellable the moment it's on
  hand, no separate admin approval step.

Backend (done):
16. `db/schema.ts` — `products.imageUrl`; `batch_items.moq` /
    `.procuredQuantity` (moved off `batches`); `batches.allowedFulfilmentMethods`
    (new — pickup/shipping/both per batch, §13.1); `orders.reservedAt`
    (stamped the instant a pre-order enters RESERVED — the §26
    shortfall-ranking key, since it has to be payment-verification time,
    not order-submission time).
17. `lib/batch-allocation.ts` (+ 7 Vitest cases) — the §26 MOQ-shortfall
    rule as a pure function, same "decision logic separate from DB
    orchestration" split as `lib/order-state-machine.ts`. Promotes
    AWAITING_STOCK orders oldest-payment-verified-first when a receipt
    doesn't cover everyone; a multi-item order is all-or-nothing (never
    partially promoted — a stuck order's available stock isn't locked away
    from a different, easier-to-satisfy order that jumps ahead of it).
18. `supabase/functions/record-batch-receipt` (new) — admin logs a supplier
    delivery for one batch line item: adds to `inventory.onHand`, then runs
    the allocation above and fires the existing `STOCK_RECEIVED` transition
    (unchanged since Milestone 1) for whoever gets promoted. Not gated on
    batch.status — a bookkeeping event, same "MOQ is informational only"
    spirit extended to the rest of procurement. Orders that don't get
    covered just stay in AWAITING_STOCK — no auto-cancellation.
19. `supabase/functions/create-order` (extended) — accepts `batchId` +
    `paymentType` for pre-orders. Skips the ready-stock physical-stock
    check entirely for pre-orders (§11.2 — commitments tracked before stock
    exists); validates the batch is OPEN, the payment type is allowed, and
    every item actually belongs to that batch. Fulfilment method stays
    forced to PICKUP server-side regardless of sales mode or what a batch's
    `allowedFulfilmentMethods` says — shipping isn't real until Milestone 3.
20. `supabase/functions/verify-payment` (extended) — now branches on
    `order.status` (PAYMENT_PENDING vs. BALANCE_DUE) and `salesMode`
    (READY_STOCK vs. PRE_ORDER). Verifying a pre-order's deposit does NOT
    touch `inventory` — it stamps `reservedAt` and moves to
    RESERVED/AWAITING_STOCK, full stop. The one exception: if this batch's
    stock already happens to be on hand (a late deposit verification after
    the batch already received stock), it allocates and promotes
    immediately instead of parking the order in AWAITING_STOCK for no
    reason. The normal "stock arrives later" case is record-batch-receipt's
    job, not this function's.
21. `supabase/functions/submit-balance-payment` (new) — customer submits
    (or resubmits, after a rejection) the remaining balance once
    BALANCE_DUE. Same ownership-via-access-token pattern as
    resubmit-payment. verify-payment (above) is what actually verifies it.

UI (done):
22. `src/pages/AdminProductsPage.tsx` (new) — create product + variants +
    photo upload; direct table writes (no Edge Function — creating a
    product is "save what the user typed", architecture.md's own rule of
    thumb for when that's fine), sequential (not transactional) since
    supabase-js/PostgREST has no multi-table transaction from the browser —
    same tradeoff already accepted for Milestone 1's manual SQL seeding.
23. `src/pages/AdminBatchesPage.tsx` (new) — create a batch (name,
    open/close, payment types, fulfilment methods with pickup forced on),
    pick products/variants into it with a per-item MOQ, see live
    ordered-quantity-vs-MOQ per item (computed from order rows, not a
    stored counter — §10.3 stays informational only), and the "record
    receipt" action per item.
24. `src/pages/HomePage.tsx` (extended) — a source switcher (ready stock, or
    one tab per open batch); picking a batch shows only that batch's items
    and, if the batch allows both, a DP-vs-FULL choice. An order can only
    belong to one sales mode/batch at a time (switching tabs clears
    quantities) — `orders.batchId` is a single column.
25. `src/pages/OrderPage.tsx` (extended) — a BALANCE_DUE card with the same
    upload-proof pattern as the existing rejected-payment resubmit card,
    calling submit-balance-payment.

Not built in this pass — flagging for whoever picks this up next:
- Live end-to-end verification against the real Supabase project (schema
  push, new storage bucket, redeploying the two extended functions plus the
  two new ones) — same "written and typechecked, not yet proven live" gap
  Milestone 1 had for payment-proof upload at handoff.
- No email in this milestone, even though §17 marks balance-due as a P0
  (never-delayed) email — building the full priority queue for one email
  type isn't worth it; every email, including this one, still waits for
  Milestone 5.
- Editing/deactivating a product after creation — Products screen is
  create-only for now (FR-001's "edit" half), matching what was actually
  asked for ("first real product-creation UI"), not the full CRUD surface.

Milestone 3 — Shipping

Backend:
22. Shipping address, cost calculation, label generation, tracking (§15).
    Label generation runs in an Edge Function (Deno) — may need a different
    PDF library than a typical Node-only package; confirm when we get here.

UI:
23. Customer checkout form (extends step 7/20 again, not a new screen) —
    adds the shipping vs. pickup choice and address fields, with cost shown
    before submitting.
24. Admin — enter tracking number, generate/print the shipping label.

Milestone 4 — Admin proper (real auth)

25. Admin auth: Supabase Auth (magic link) for staff login, replacing the
    hardcoded admin id used since Milestone 1. Per-action permission
    toggles from §18.4 (admin_users table, already in db/schema.ts) enforced
    for real.
26. The simple, no-login admin screens built ad hoc in Milestones 1–3 get
    replaced by a real dashboard (§18.1: payment queue, DP balances due,
    active batches, orders awaiting stock/pickup/shipping) — action buttons
    disabled (not hidden) per §18.4 when the logged-in staff member lacks
    that permission.

Milestone 5 — Email + Push

Simplified in PRD v1.3: 4 core emails, not up to 9 — P0/P1 only, no P2 tier
at all (dropped along with the events that used it: shipped, picked up,
completed — customer sees these on the order page instead). The first
customer email now fires *after* admin verifies payment (combining "order
confirmed" + "payment verified" into one), not at order submission.

27. Email queue table + worker + Resend (§17, §24) — Resend free tier only
    (100/day hard cap, sender @resend.dev, no custom domain/DNS needed for
    MVP — §24.4 has the future upgrade path if/when a domain gets bought).
    P0 (payment rejected, balance due) never deferred, retries next day at
    00:01 on a 429. P1 (order confirmed, ready for fulfilment) deferred to
    next day if the cap's hit; >80 simultaneous balance-due emails batch
    across days, earliest-verified first. Worker is a scheduled Edge
    Function (Supabase's cron/scheduled functions support) — exact setup to
    confirm when we get here.
28. Web Push (§17a) — new in v1.3, a $0 backup channel that bypasses email
    caps/spam filters entirely. Subscription happens right on the order
    page ("Allow notifications?"), stored against the order id — no
    customer account, same guest-first model as everything else. Covers
    payment rejected, balance due, ready for fulfilment (not "order
    confirmed" — email-only for that one). Genuinely simpler than the email
    queue (no priority tiers, no daily cap to manage) — worth considering
    building before or alongside email rather than strictly after, when we
    get here.
29. WhatsApp manual fallback (§17a.3) — not something to build; an
    operational acknowledgment that staff can export phone numbers and
    message customers manually when email/push both fail. The phone-lookup
    already built into the scanner (Milestone 1, step 9) covers the
    "find this customer's order" half of that workflow already.

Milestone 6 — Remaining edge cases

30. Order access recovery via phone+email (§16, §27) — Edge Function, since
    matching phone+email isn't a simple RLS row match.
31. Payment proof 30-day retention cleanup (§8) — scheduled Edge Function,
    deletes from Supabase Storage.
32. Audit log viewer in admin UI — direct Supabase read gated by RLS
    (canViewAuditLog), same pattern as other admin dashboard reads.
