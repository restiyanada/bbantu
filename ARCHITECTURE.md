# Architecture

Running log of *why* this project is built the way it is. The PRD (`PRD.html`
— a stable filename kept up to date in place, currently v1.3; the file's own
changelog tracks version history, so there's no need to rename it on every
revision and update every cross-reference)
defines business rules — this doc is implementation decisions, which the PRD
deliberately stays agnostic about (§30/§31 describe the architecture in
framework-neutral terms).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React (SPA) + Tailwind | No SSR needed — guest-first, no SEO requirement (non-goal §2), pages are accessed via shared tokenized links |
| Hosting (frontend) | Cloudflare Pages | Free unlimited bandwidth; static build needs no adapter, unlike running Next.js on Cloudflare Workers |
| Domain | Cloudflare Registrar (when ready) | Cheapest wholesale pricing, no renewal markup; using free `.pages.dev` until launch |
| Database | Supabase Postgres | Schema in `db/schema.ts`, pushed via Drizzle |
| Backend logic | Supabase Edge Functions (Deno) | See "Security boundary" below |
| Auth (staff) | Supabase Auth, magic link | Identity only — see "Auth vs permissions" |
| Auth (guests) | High-entropy access tokens (§16, §27) | Not a real auth system — phone+email lookup for recovery, no password |
| File storage | Supabase Storage | Payment proofs (§8), 30-day retention |
| Email | Resend, called from an Edge Function | Unchanged since v1.1 of the PRD |
| Admin UI | shadcn/ui + TanStack Table **v8** + React Hook Form + Zod | See "Admin UI" below |
| Testing | Vitest | See "Testing scope" below |

## Security boundary — read this before adding any new endpoint

**There is no server between the browser and the database.** That's the
single biggest consequence of not using Next.js API routes. PRD §3 principle
5 ("backend is the source of truth — frontend actions cannot bypass business
rules") is enforced entirely by:

1. **Row Level Security (RLS) policies** on every table, for direct reads/writes
   the browser is allowed to do with the publishable key.
2. **Supabase Edge Functions**, using the service role key (bypasses RLS), for
   anything that must not be trusted to the client.

**Rule of thumb:** if an action changes state based on a business rule (not
just "save what the user typed"), it's an Edge Function, not a direct table
write. Concretely:

- Order status transitions (calls `lib/order-state-machine.ts`) → Edge Function
- Payment verification/rejection → Edge Function
- **Order creation** → Edge Function, not a direct insert — otherwise the
  client could set its own `merchandiseSubtotal` and pay whatever it wants.
  Price must be computed server-side from `product_variants.price`, not
  trusted from the request body.
- Inventory allocation → Edge Function
- Reading your own order status (guest, via access token) → direct
  Supabase read is fine, gated by an RLS policy matching the token
- Admin dashboard reads (once logged in) → direct Supabase reads are fine,
  gated by RLS matching the authenticated admin

## Auth vs. permissions — these are two different systems

Easy to conflate, so spelled out explicitly:

- **Supabase Auth** answers *"who is this person"* — magic link login for the
  3 staff members. That's all it does.
- **The `admin_users` table** (`db/schema.ts`) answers *"what can they do"* —
  per-action boolean toggles (`canVerifyPayments`, `canScanConfirmPickup`,
  etc.) matching PRD §18.4 exactly. This is looked up *after* login, keyed by
  the authenticated user.
- Dashboard is read-only for every admin regardless of these flags (§18.4);
  the flags only gate whether action buttons are enabled or disabled, never
  hidden.

## Cloudflare Workers — deliberately not used, revisit later if it earns it

Considered and set aside. Moving Edge Functions to Cloudflare Workers would
consolidate deploys (one push instead of two) and let the backend share
Drizzle/`postgres.js` with the schema tooling instead of using `supabase-js`
in Deno. But it also requires Cloudflare Hyperdrive to connect to Postgres
properly, and throws away the already-working Supabase Edge Functions
pattern. **Not revisiting this until the two-deploy-pipeline friction is a
real, felt problem** — not swapping on architecture-purity grounds alone.

## Admin UI

PRD §18 needs sortable/filterable tables, forms with validation, and
accessible modals/dropdowns — enough real interaction complexity that hand-
rolling all of it in raw Tailwind isn't worth it. Three additions, each
justified by a specific need:

- **shadcn/ui** — copy-paste components (not a black-box package), so we own
  and can edit the code. `Button`, `Badge`, `Card` are already hand-authored
  in `src/components/ui/` to match the CLI's output exactly (the CLI itself
  couldn't run in the sandbox that built the scaffold — network-restricted,
  not a real limitation). Pull more with `npx shadcn@latest add <name>`.
- **TanStack Table — pinned to v8**, not the newly-released v9. v9 shipped
  with a restructured API after this project's tooling knowledge was set;
  rather than build on an unfamiliar, very recent API for code handling real
  order/payment data, v8 (stable, widely documented) was used instead. Revisit
  deliberately later if there's a specific reason to.
- **React Hook Form + Zod** — see `src/components/payment-rejection-form.tsx`
  for a real (not toy) example: it enforces §8.3's "rejection reason
  required" rule. Client-side validation is a UX nicety only — the Edge
  Function that actually performs the rejection must re-validate the same
  rule server-side, since a browser check alone is never sufficient (§3.5).

## Testing scope

`lib/order-state-machine.ts`, `lib/orders.ts`, and `lib/audit.ts` have
permanent unit tests (Vitest, 26 cases total as of Milestone 1) — the state
machine's branches, plus the orchestration/write-sequencing logic in
`orders.ts`/`audit.ts` tested against a fake transaction rather than a live
DB. Still deliberately **not** adding component or E2E tests: `OrderPage.tsx`
now has real behavior (Milestone 1 step 6), which is the trigger condition
this section used to name — but component testing (React Testing Library +
mocking `supabase-js`) is its own chunk of setup, not something to fold in
as a side effect of wiring one page. Worth doing as a deliberate next step,
not implied-done here.

## What survived the Next.js → Vite pivot untouched

Worth knowing for future decisions: `db/schema.ts` and
`lib/order-state-machine.ts` are framework-agnostic TypeScript with zero
dependency on Next.js or Vite. Both copied over with **no changes** when the
frontend framework changed. If the frontend or hosting changes again later,
these two files are very unlikely to be affected — a useful signal for how
much of a "big rewrite" any future stack question actually is.

## Milestone roadmap

See project's `milestone` file for the six numbered milestones. Unaffected by
the architecture pivot in scope/order — only the implementation vehicle for
each step changed (Next.js API routes → Supabase Edge Functions, Next.js
pages → React Router pages + `supabase-js`).

## Milestone 1 decisions

### Payment proof UI polish: Dialog component, image-only

After clicking through the built payment-proof flow: checkout reordered
(customer details first, then order summary/bank info/upload — was the
reverse), proof restricted to images only (dropped PDF from both the
Storage bucket's `allowed_mime_types` and the client-side accept/validation
— removes any need for a PDF-vs-image branch in the viewer), and the
"View proof" link moved out of the admin table's Actions column into its
own Proof column.

**First real use of `src/components/ui/dialog.tsx`** — `@radix-ui/react-dialog`
was already a dependency (added early, never wrapped into a component).
Standard shadcn Dialog primitives (Root/Trigger/Portal/Overlay/Content/
Header/Title), used here for the proof-image popup instead of opening the
signed URL in a new tab.

### Payment proof upload — a real Storage feature, not just a form field

PRD v1.3 made §7.2's payment proof requirement explicit (order + proof are
one atomic submission, not optional). This needed genuine new
infrastructure, documented here since none of it existed before:

**The bucket is set up outside drizzle-kit entirely.** `supabase/storage_setup.sql`
creates the private `payment-proofs` bucket + an insert-only policy for
`anon` directly in the SQL console — not through `db/schema.ts`. Supabase's
own docs say to treat the `storage` schema as read-only/API-managed, not
something an ORM should introspect or migrate. Bucket-level `file_size_limit`
(5MB) and `allowed_mime_types` (jpeg/png/webp/pdf) enforce validation
server-side, not just in the browser (§19 "upload validation").

**Chicken-and-egg: the file has to exist before the order does.** §7.2 wants
order creation and payment proof to be one atomic flow, but the order (and
its id) doesn't exist until `create-order` succeeds — so the upload can't be
scoped to "this order's files" the way everything else in this schema is
scoped by id. Solved by keying the upload path to `submissionToken`
(already generated client-side before submission) instead: `{submissionToken}/{filename}`.
The bucket has **no select/list policy for `anon` at all** — customers can
write, but can't read back any proof, including their own — so this
write-anywhere-in-the-bucket policy doesn't leak anything; the actual
security boundary is "nobody except service-role can read," not "customers
can only write to their own folder."

**A claimed proof path is verified, not trusted.** `create-order` and
`resubmit-payment` both run `select 1 from storage.objects where bucket_id =
'payment-proofs' and name = $1` before proceeding — `storage.objects` is
metadata Supabase's docs explicitly say is safe to *read* directly (just not
write to), so this needs no extra Storage API client, just the same
Postgres connection already used for everything else. A client that skips
the actual upload and just POSTs a made-up path gets rejected.

**Admin needs to *see* the proof, which needs a different client.**
Read-back for a private bucket requires either a service-role connection or
a signed URL — raw SQL reads of `storage.objects` only return metadata
(path, size, mime type), not file bytes or a usable link. `list-orders` now
also uses a plain `supabase-js` client with `SUPABASE_SERVICE_ROLE_KEY`
(`_shared/storage.ts`, `createSignedUrl`) alongside its existing direct-
Postgres connection — two different clients doing two genuinely different
jobs in the same function, not redundant.

**Resubmission reuses the reject-doesn't-move-order-status design.**
`resubmit-payment` is customer-facing (unlike verify-payment/scan-pickup),
so unlike those it genuinely needs to verify the caller owns the order —
done via the same access token already used for reading the order page, not
the order id (which isn't secret). Only allowed when the *latest* payment
for that order is `REJECTED`; this also keeps the pre-existing "at most one
PENDING payment per order" invariant intact (confirmed, not assumed —
checked in `list-orders`'s comment) since a second resubmit attempt while
one's already pending hits a 409 instead of ever producing two PENDING rows.

**DP wording is written now, unreachable until Milestone 2.** The checkout
summary branches on `paymentType` ("FULL" vs "DP") even though `create-order`
only ever produces FULL orders in this milestone — so Milestone 2 doesn't
need to touch this component's core logic when DP selection actually
becomes reachable, just wire a real value into the branch that already exists.

**Bank account config: one global row, not per-batch yet.** `payment_settings`
is a single-row table for now (bank name, account number, holder name), admin-
edited directly via SQL console. Deliberately not adding an unused `batchId`
column now — batches don't exist yet, and a nullable column that does
nothing until Milestone 2 actually builds batches is dead schema in the
meantime. Milestone 2's batch work adds that column when it's actually needed.

### User feedback pass: order numbers, short codes, phone lookup, colors

Four small changes requested after clicking through the built UI:

**Sequential order numbers, not raw UUIDs.** `orders.order_number` (plain
integer) plus two Postgres sequences, `pickup_order_seq` and
`shipping_order_seq` (`db/schema.ts`) — separate counters per fulfilment
type, not one shared counter, so pickup and shipping orders each read as
`#010001`, `#010002`... / `#020001`, `#020002`... The `01`/`02` type prefix
is derived from `fulfilmentMethod` at display time
(`src/lib/utils.ts` → `formatOrderNumber`), not stored — avoids keeping a
second, potentially-stale copy of data the column already holds.
`create-order` assigns the number via `nextval('pickup_order_seq')` inside
the same transaction (M1 only ever creates PICKUP orders; shipping draws
from the other sequence once Milestone 3 exists). This is a plain
`CREATE SEQUENCE` + `ADD COLUMN` change — doesn't touch any RLS policy, so
unlike the schema change earlier in this doc, `drizzle-kit push` should
apply it correctly. Worth a quick verification anyway now that trust in
`push` is calibrated:
```sql
SELECT last_value FROM pickup_order_seq;  -- should exist, start near 1
SELECT tablename, policyname, qual FROM pg_policies WHERE qual IS NULL;  -- still empty
```

**Shorter pickup codes.** `prepare-pickup` now generates a 6-character code
from a 32-symbol alphabet (excludes `0/O/1/I/L` to avoid characters that
look alike) instead of a full UUID — same order of magnitude of
unguessability (~1 billion combinations) for a booth-pickup context, much
easier to type as the manual fallback. A cheap retry-on-collision loop
handles the (astronomically unlikely) case of hitting the same code twice.

**Phone-number lookup on the scanner.** `scan-pickup` now accepts a third
input shape, `{ phone }`, alongside `{ token }` and `{ token, confirm }` —
returns every `READY_FOR_PICKUP` order for that phone number so staff can
pick the right one by name, then the flow converges back to the existing
token-based confirm. Deliberately *not* a fourth way to confirm a pickup
directly by phone: §27 is explicit that phone numbers aren't secret, so
this is a search shortcut, not proof of identity — staff still visually
confirm before pressing Confirm, same as the QR-scan path.

**Status colors, for real this time.** `Badge` and `Button`
(`src/components/ui/`) gained `warning`/`info`/`success` variants
(amber/blue/green), extending the original shadcn-generated 4. The
status→color mapping (`src/lib/utils.ts` → `statusBadgeVariant`) was
previously duplicated 3 ways across pages with only 3 tones total; now
consolidated in one place, covering all 12 order statuses with actual
semantic grouping (amber = waiting on someone, blue = in progress,
green = done, red = problem) instead of just default/secondary/destructive.

### UI pass: a 5th Edge Function, and one new dependency

The original Milestone 1 build (backend only) proved every rule works, but
only via curl — nothing a customer or admin could actually click through.
Adding real UI surfaced two things not anticipated in the original plan:

**`list-orders` — a 5th Edge Function, not in the original 4.** The admin
action screen needs to see every order, but the RLS policy on `orders`
deliberately only allows a guest to read *their own* order (matched by
access token). There's no "staff" role for RLS to grant broader access to
yet (that's Milestone 4's job). So, same pattern as the other admin-facing
functions: a small Edge Function using the service-role connection
(bypasses RLS) returns what the admin screen needs. Same "not secure yet,
don't expose the URL" caveat applies — now covering a *read* of every
customer's name and phone number, not just writes, which is arguably worse
until Milestone 4 lands.

**`qr-scanner` (npm) for the pickup scanner page.** Chosen over hand-rolling
camera + QR decoding: lightweight, actively maintained, worker-based (won't
block the UI thread decoding frames). Verified for real, not assumed: the
package's own README says bundlers handle its dynamic worker import
automatically, and a real `npm run build` in this repo confirms it —
`qr-scanner-worker.min-*.js` shows up as its own emitted chunk in `dist/`,
no manual `QrScanner.WORKER_PATH` override needed.

### `src/pages/ScanPage.tsx`, `src/pages/AdminDashboardPage.tsx`, `src/pages/HomePage.tsx`

- `HomePage.tsx` is now the real checkout form (was a placeholder). Reads
  `products`/`product_variants` directly via `supabase-js` (no RLS on those
  tables — public storefront catalog, §5) — not through an Edge Function,
  since it's not a business-rule computation. **Payment proof upload is
  still not wired** (Supabase Storage bucket + RLS don't exist yet, flagged
  since the original Milestone 1 build) — the form has no field for it;
  `create-order` accepts an optional pre-uploaded URL but nothing currently
  produces one. Still an open gap, not silently resolved.
- `AdminDashboardPage.tsx` replaces the dummy-data TanStack Table placeholder
  with real data from `list-orders`, plus Verify/Reject (reusing the
  already-built `PaymentRejectionForm`) and Prepare-for-Pickup actions.
- `ScanPage.tsx` is new — camera-based scanning (§14), pausing on a hit,
  looking up via `scan-pickup`, then a separate "Confirm pickup" button
  (matching §13.2's two-step design already built into the backend). Manual
  code entry as a fallback if the camera fails or is denied.
- Extracted `formatIDR` into `src/lib/utils.ts` — was about to be duplicated
  a third time across `OrderPage`/`HomePage`/`AdminDashboardPage`, past the
  "copy twice, then abstract" threshold.

None of this changes the Milestone 4 auth gap — if anything it widens what's
exposed until then, since the admin screen and scanner page now both work
end-to-end with zero login. Worth prioritizing Milestone 4 sooner rather
than treating it as "eventually," now that there's an actual admin UI
someone could stumble onto.

### Order transitions need a real transaction

`lib/orders.ts` (`transitionOrder`) wraps a status change + audit row in one
DB transaction, per milestone.md step 1 and §20. `supabase-js`/PostgREST
can't do this — each `.from().insert()` call is its own HTTP request, so
there's no way to make two of them atomic. Instead, Edge Functions that
change order state connect **directly to Postgres** via
`drizzle-orm/postgres-js` (`supabase/functions/_shared/db.ts`), the same
driver already used for Drizzle Kit migrations. `health/index.ts` still uses
`supabase-js` — that's fine, it doesn't write anything. The rule going
forward: if a function needs a multi-statement transaction, it uses
`_shared/db.ts`; if it only needs a single read/write, `supabase-js` (with
the service role key) is simpler and fine.

This requires a `DATABASE_URL` secret (`supabase secrets set DATABASE_URL=...`,
the pooled connection string from Database settings) that doesn't exist yet
in this project — not deployed/tested against the live Supabase project from
this environment (see "What's still unverified" below).

### Deno resolves the same bare specifiers as Node

`supabase/functions/deno.json` is an import map (`"drizzle-orm/pg-core":
"npm:drizzle-orm@0.45.2/pg-core"`, etc., pinned to match `package.json`).
This lets `db/schema.ts` and `lib/orders.ts`/`lib/audit.ts` import bare
specifiers exactly like the Node/Vitest side, and run **unmodified** under
both — no duplicated schema or state-machine logic between the two runtimes.
The one adjustment needed: relative imports inside those files use explicit
`.ts` extensions (`"./order-state-machine.ts"`), since Deno requires them;
`tsconfig.lib.json` sets `allowImportingTsExtensions` so this doesn't break
the Node/Vitest side.

Verified for real: cloned a Deno 2.1.4 binary into this environment and ran
`deno check --config supabase/functions/deno.json` against every new file,
including the structural-typing question of whether a real
`db.transaction()` callback satisfies `OrdersTransaction`/`AuditWriter` (it
does). Needed `DENO_CERT=/etc/ssl/certs/ca-certificates.crt` to fetch from
the npm registry in this sandbox — Deno doesn't pick up the sandbox's CA
bundle the way `curl`/`npm` do. Not expected to be an issue on Supabase's
actual Edge Runtime, but flagging since it's an unusual fix.

### Guest order page: header-matched RLS, not a fixed relationship

`db/schema.ts` adds RLS policies on `orders`, `order_items`, `payments`,
`pickup_tokens` using PostgREST's `request.headers` GUC:

```sql
using ("orders"."access_token" = (current_setting('request.headers', true)::json ->> 'x-order-access-token'))
```

`src/lib/supabaseClient.ts` adds `createGuestOrderClient(token)`, a client
scoped to one order's access token via that header — `OrderPage.tsx` creates
one per page load (route is now `/orders/:accessToken`, not `/orders/:id`,
since the access token is what actually grants access; the DB's own row id
isn't secret and isn't what RLS checks). This is what makes it a real
security boundary rather than a convenience filter: RLS `using` applies to
every query regardless of what `.eq()` the client's own code adds, so a
client can't just drop the filter and read every order.

**Unverified**: this SQL is syntactically valid (confirmed via
`drizzle-kit generate`, which doesn't need a live DB) and the
`current_setting('request.headers')::json` pattern is long-standing/widely
documented for Supabase, but it hasn't run against a real PostgREST instance
from this environment. Test this specifically once deployed.

While in `db/schema.ts` for this: `customers` and `admin_users` had **no
RLS at all** (nothing in the schema did, before this milestone) — meaning
both were fully readable via the public anon key once this project is live.
Enabled RLS with zero policies on both (deny-all for `anon`/`authenticated`;
Edge Functions still work since the service-role connection bypasses RLS
entirely). Didn't extend this to every other table (`inventory`, `batches`,
etc.) — that's a broader hardening pass worth doing deliberately, not a
side effect of wiring one page.

### No real auth yet — by design, but flagged loudly

`verify-payment`, `prepare-pickup`, and `scan-pickup` all use a hardcoded
`HARDCODED_ADMIN_ID` constant, matching milestone.md step 4's explicit scope
("no real auth yet ... Supabase Auth comes in Milestone 4"). `verify_jwt` is
`false` project-wide (`supabase/config.toml`), so as it stands, anyone with
the public anon key can currently call any of these three functions and
verify payments, stage orders for pickup, or confirm pickups. Each file has
a loud comment to this effect. **Do not deploy these three functions to a
public-facing project URL before Milestone 4** adds real staff auth + the
§18.4 permission checks — for now, treat them as manually-invoked only.

### `prepare-pickup`: a 4th Edge Function beyond the 3 milestone.md names

milestone.md step 5 says "Pickup QR: token generation + a
`supabase/functions/scan-pickup` endpoint," which reads as one function.
Split it into two instead: `prepare-pickup` (READY_FOR_FULFILMENT →
READY_FOR_PICKUP + token generation) and `scan-pickup` (lookup, then a
separate `confirm: true` call → PICKED_UP). Reasoning: the state machine
(`lib/order-state-machine.ts`, written in an earlier session, not touched
here) already models `READY_FOR_FULFILMENT` and `READY_FOR_PICKUP` as
separate states with their own event (`PREPARE_FOR_FULFILMENT`) — that's a
strong signal the original design intended "payment/reservation settled" and
"physically staged for pickup" to be distinct admin actions, not
auto-chained. `verify-payment` stops at `READY_FOR_FULFILMENT` accordingly.
If that turns out to be the wrong call for how the ready-stock + pickup flow
actually operates day-to-day, the fix is to fold `PREPARE_FOR_FULFILMENT`
back into `verify-payment`'s chain — worth revisiting once there's a real
admin UI and it's clearer whether "stage for pickup" is ever a meaningfully
separate action from "payment verified," or always happens in the same
breath for ready stock specifically.

### `lib/` and `db/` weren't actually type-checked before this milestone

`tsc -b` only ever covered `src/` (`tsconfig.app.json`) and `vite.config.ts`
(`tsconfig.node.json`) — `lib/order-state-machine.ts` was exercised by
Vitest (which transpiles but doesn't type-check) but never ran through the
TypeScript compiler itself. Added `tsconfig.lib.json` (covering `lib/` and
`db/`) as a third project reference to close this gap. Deliberately *not*
reusing `erasableSyntaxOnly` from `tsconfig.app.json` here — that flag exists
for runtimes that only strip types without transforming syntax (e.g. Node's
native `.ts` support), which doesn't describe either real consumer of this
code (Vitest/esbuild and Deno/swc both fully transform), and it would have
forced a rewrite of the existing `OrderTransitionError` class's constructor
parameter properties for no actual benefit.

### Repo hygiene: `node_modules/` and `dist/` are tracked in git

Discovered while reinstalling to verify the project builds — no
`.gitignore` existed, and both directories (11,000+ files) are committed.
Added `.gitignore` so this doesn't get worse, but didn't run
`git rm -r --cached node_modules dist` myself — that's a large, visible
history change worth the repo owner doing deliberately rather than as a side
effect of a milestone. Worth doing soon: it was actively producing noise
(an unscoped lint run picked up 7,125 files and 25,000+ warnings from
vendored/minified code before I scoped it to `src`/`lib`/`db`/`supabase`).

### `drizzle-kit push` silently drops RLS policy conditions

Found live, not in this sandbox: after `npx drizzle-kit push` against the
real Supabase project, `OrderPage.tsx`'s read came back empty even with a
correct access token. `SELECT tablename, policyname, qual FROM pg_policies`
showed `qual: NULL` for all four guest-read policies — the policy rows
existed, but their `USING` condition never got attached, which Postgres
treats as deny-all rather than allow-all.

This is a confirmed drizzle-kit bug, not anything wrong with the schema or
the RLS design: [drizzle-orm#3504](https://github.com/drizzle-team/drizzle-orm/issues/3504)
("RLS Policies not applied with `push` but applied with `migrate`") and
[drizzle-orm#4078](https://github.com/drizzle-team/drizzle-orm/issues/4078)
("RLS `using` rule not applied to supabase") describe this exact symptom.
`drizzle-kit generate` (confirmed earlier in this doc, via inspecting the
generated `.sql` directly) produces the correct `USING` clause every time —
the bug is specifically in `push`'s diff-and-apply path.

**Going forward: don't use `drizzle-kit push` for schema changes that touch
RLS policies.** Use `drizzle-kit generate` + `drizzle-kit migrate` (runs the
literal generated SQL) instead, or apply the generated `.sql` file by hand
via the SQL console. After any push/migrate touching policies, a quick
verification is worth it:
```sql
SELECT tablename, policyname, qual FROM pg_policies WHERE qual IS NULL;
```
Empty result = safe. Any rows back = a policy silently lost its condition.

Fixed live for now via `DROP POLICY` + `CREATE POLICY` (with the exact
`USING` clauses from `db/schema.ts`) run directly in the SQL console — the
schema-as-code and the live database match again, this just didn't go
through `push`.

**⚠️ It happened again, much bigger, and the warning above didn't prevent
it.** Milestone 4's push (`d07afd5`/`7aada48`, adding every `staff_can_*` /
`canManageProductsBatches` policy plus the four `anyone_can_read_*` catalog
policies) hit the identical bug. Not caught at the time — it surfaced days
later, live, during Milestone 2 admin UI testing: `/admin/products`'
"Create product" button was permanently disabled (a `canManageProductsBatches`
check with nothing behind it), and separately the public storefront showed
"Nothing available to order right now" for any genuinely anonymous customer
(incognito), because `anyone_can_read_products` — a plain `using: sql\`true\``
— had also been pushed with a NULL `qual`. Both symptom and root cause took
a long back-and-forth to isolate precisely because a NULL condition doesn't
error — it just denies silently, and (confusingly) other overlapping
policies on the same table can mask the break, e.g. an authenticated admin
could still browse products via the (correctly-pushed) `staff_can_manage_products`
`ALL` policy, while the broken `anyone_can_read_products` `SELECT` policy
sat unnoticed underneath it.

13 policies total were confirmed NULL and fixed live the same way (`DROP` +
`CREATE` with the literal `db/schema.ts` condition): `staff_can_manage_products`,
`staff_can_manage_product_variants`, `staff_can_manage_batches`,
`staff_can_manage_batch_items`, `staff_can_read_inventory`,
`staff_can_create_inventory_rows`, `staff_can_read_all_orders`,
`staff_can_read_all_order_items`, `staff_can_read_own_admin_row` (this one
had to be added fresh — `admin_users` had RLS enabled with *zero* policies,
which independently breaks every other table's `exists(select 1 from
admin_users ...)` check, since that subquery is itself subject to
`admin_users`'s own RLS for a non-owner role), `anyone_can_read_products`,
`anyone_can_read_product_variants`, `anyone_can_read_batches`,
`anyone_can_read_batch_items`.

**The lesson isn't "remember not to use push" — that clearly doesn't work as
a written warning alone.** Concretely, going forward:
- After *any* `drizzle-kit push` that touches a table with `pgPolicy(...)`
  in its definition, run the verification query above **before** considering
  the push done, not as an optional afterthought.
- Prefer `drizzle-kit generate` + `drizzle-kit migrate` for anything RLS-related,
  per the original guidance above — it's not just theoretically safer, it's
  now confirmed safer twice.
- If a page/action that depends on RLS starts behaving like "permanently
  disabled with no error" or "works for me but not for a fresh/anonymous
  session," check `pg_policies` for `NULL` conditions first — it's now
  happened twice, on two different tables, both times just like this.

### Verified live against the real Supabase project

Everything below was originally written as "unverified — needs a real
Supabase project" (this sandbox has no network path to Supabase). All of it
has since been run for real, end-to-end, against the live project
(`lhvxjgbjjamwatsmxiyc`):
- `DATABASE_URL` secret + Edge Functions connecting directly to Postgres —
  confirmed working (`verify-payment`'s 3-way chained transition +
  inventory reservation ran correctly).
- `drizzle-kit push` applying the schema — ran successfully, **except** for
  the RLS policy bug documented above, which push doesn't surface as an
  error at all (silent data-shape loss, not a failure).
- The `request.headers` RLS pattern against real PostgREST — confirmed
  working once the policies actually had their `USING` clause attached (see
  above); isolated via a direct `curl` to `/rest/v1/orders` with the custom
  header, bypassing the frontend entirely, before also confirming it in the
  browser.
- All four Edge Functions deployed and exercised through the full order
  lifecycle: `create-order` → `verify-payment` (VERIFY) → `prepare-pickup`
  → `scan-pickup` (lookup, then confirm) → repeat confirm correctly
  rejected with `OrderTransitionError` (409), proving §13.3 for real.
- `OrderPage.tsx` rendering real data through the token-scoped client.

Milestone 1 is now confirmed working end-to-end against a live project, not
just internally consistent in a sandbox.