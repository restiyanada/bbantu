# Pre-Order & Ready Stock System

A guest-first storefront for running pre-order batches and ready-stock sales:
customers order without an account, upload proof of a bank transfer, and track
the order through a tokenized link. Staff verify payments, manage batches and
stock, print shipping labels, and confirm booth pickups by scanning a QR code.

All six milestones are built. See `milestone.md` for what each one covered and
what's still open, `ARCHITECTURE.md` for why the implementation looks the way
it does, and `PRD.html` for the business rules (referenced throughout as §n).

## Stack

- **Frontend:** Vite + React (SPA) + Tailwind, hosted on Cloudflare Pages
- **Admin UI:** shadcn/ui, TanStack Table v8, React Hook Form + Zod, sonner
- **Backend logic:** Supabase Edge Functions (Deno) — anything enforcing a
  business rule lives here, never as a direct write from the browser
- **Database:** Supabase Postgres, schema in `db/schema.ts` via Drizzle
- **Auth:** Supabase Auth (magic link) for staff; high-entropy access tokens
  for guest order access (§16, §27) — separate systems, not the same thing
- **File storage:** Supabase Storage — payment proofs (private, 30-day
  retention) and product images (public, never deleted — see "Product photos")
- **Email:** Resend, sent by a scheduled Edge Function off a queue table
- **Testing:** Vitest — 71 unit tests over the pure logic in `lib/`

## The security boundary

**There is no server between the browser and the database.** Two things
enforce PRD §3 principle 5 ("backend is the source of truth"):

1. **RLS policies** on every table, for the reads the browser does directly
   with the publishable key.
2. **Edge Functions** using the service-role key (which bypasses RLS) for
   anything that must not be trusted to the client.

**Rule of thumb:** if an action changes state based on a business rule — not
just "save what the user typed" — it's an Edge Function. Order creation
computes prices server-side from `product_variants.price` and re-fetches
shipping rates from the courier; neither is ever trusted from the request body.

Staff-facing functions call `requireAdmin(req, permission)`
(`supabase/functions/_shared/auth.ts`), which verifies the JWT and then checks
the §18.4 per-action toggle in `admin_users`. The frontend gets those toggles
from the `whoami` function, so a disabled button is UX only — the same check
runs again server-side.

⚠️ **Never apply an RLS change with `drizzle-kit push`.** It silently drops
policy `USING` conditions, which Postgres then treats as deny-all. This has
broken this project twice — see ARCHITECTURE.md. Run the migration SQL by hand
in the Supabase SQL editor instead, then verify:

```sql
SELECT tablename, policyname, qual FROM pg_policies WHERE qual IS NULL;
-- empty result = safe
```

**Why by hand rather than `drizzle-kit migrate`:** this project's live database
has only ever been schema-managed with `db:push`, which keeps no record of what
it applied. `migrate` tracks applied migrations in its own
`drizzle.__drizzle_migrations` table — which therefore doesn't exist here, so
the first `migrate` run would consider *every* migration unapplied and try to
replay `0000` onward against a database that already has all of it. Until
someone deliberately reconciles that bookkeeping (backfilling the table to
match reality), by-hand SQL is the safe path.

## Product photos and what an order remembers

A product has an ordered list of photos in `product_images`. `sort_order` 0 is
the cover, and the app mirrors that URL into `products.image_url`, so the
storefront grid, order-tracker thumbnails and shipping labels keep reading one
column. Customers open a photo sheet from a product card or an order item and
swipe the gallery.

**An order item stores what it was sold as.** `order_items` already captured
`unit_price` rather than joining live to `product_variants.price`; it now
captures `product_name`, `variant_name` and `image_urls` the same way. Without
that, editing a product would rewrite what every past order appears to contain
— rename a product and last month's tracking links quietly rename too.

Two consequences worth knowing:

- **Removing a photo from a product deletes the row, never the Storage
  object.** Old orders' `image_urls` point at those files. Nothing prunes the
  `product-images` bucket, deliberately — unlike payment proofs, which a
  scheduled function deletes at 30 days.
- **Descriptions are still joined live**, on purpose: an edit there is usually
  a correction that helps the buyer, and it isn't what identifies the item.
- Items on orders placed before the snapshot columns existed have NULL there
  and fall back to the live join, which is the behaviour they already had.

## Folder structure

```
src/
  pages/                 ← route components (checkout, order tracker, admin, scanner)
  components/ui/         ← shadcn/ui primitives
  components/            ← app components (data table, forms, shipping label)
  lib/                   ← supabase clients, adminAuth context, formatting helpers
lib/                     ← pure business logic, shared with Edge Functions, unit-tested
  order-state-machine.ts   order status transitions
  orders.ts / audit.ts     transactional transition + audit write
  batch-allocation.ts      §26 MOQ-shortfall ranking
  email-cap.ts             Resend free-tier budget allocation
  proof-retention.ts       30-day payment-proof eligibility
  rate-limit.ts            §16.1 per-IP thresholds
db/
  schema.ts              ← all tables, RLS policies, sequences
  migrations/            ← see "Migrations" below
supabase/
  functions/             ← 18 Edge Functions + _shared/
  *_storage_setup.sql    ← Storage buckets (set up via SQL console, not Drizzle)
```

## Migrations

Two kinds live in `db/migrations/`, and the difference matters:

- **Journaled** (in `meta/_journal.json`) — generated by `drizzle-kit generate`.
- **Hand-written, not journaled** — `0004`, `0006`, `0009`. Pure SQL with no
  `schema.ts` change (pg_cron schedules, one-time data backfills). Nothing
  replays these automatically. Each file's header says what it does and how to
  verify it.

**Both kinds are applied the same way against the existing project: paste the
file into the Supabase SQL editor and run it.** See the `migrate` note above
for why — the bookkeeping table it relies on was never created here. Journaled
vs. not is about whether `drizzle-kit generate` can regenerate the file from
`schema.ts`, not about how it reaches the database.

## First-time setup

1. **Install the Supabase CLI** (for Edge Functions):
   ```bash
   npm install -g supabase && supabase login
   supabase link --project-ref lhvxjgbjjamwatsmxiyc
   ```

2. Create `.env.local`:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Project Settings → API
   - `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` — Connect → Session pooler
     (for schema pushes only; never shipped to the browser)

3. Install dependencies, then apply the schema:
   ```bash
   npm install
   ```
   Run every file in `db/migrations/*.sql` in order, plus the two
   `supabase/*_storage_setup.sql` files, by hand in the SQL editor — not
   `db:push` and not `drizzle-kit migrate`, for the reasons above. (A genuinely
   fresh project could use `migrate`; this one can't until the bookkeeping is
   reconciled.)

4. Set the Edge Function secrets:
   ```bash
   supabase secrets set DATABASE_URL=... ACCESS_TOKEN_ENC_KEY=... \
     RESEND_API_KEY=... RESEND_FROM_ADDRESS=... FRONTEND_BASE_URL=... \
     SHIPPING_API_KEY=... BUSINESS_NAME=...
   ```
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   injected by the platform.)

5. Seed one row each in `payment_settings` and `shipping_settings` — checkout
   shows the bank details from the first, shipping quotes need the origin from
   the second.

6. Run it: `npm run dev`

## Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run lint` | oxlint |
| `npm test` | Run the test suite once |
| `npx drizzle-kit generate` | Generate a migration from `schema.ts` |
| `npx drizzle-kit migrate` | ⚠️ Don't run against this project — see Migrations |
| `npm run db:studio` | Browse data in Drizzle Studio |
| `supabase functions deploy <name>` | Deploy one Edge Function |
| `supabase secrets set KEY=value` | Set an Edge Function secret |

## Deploying

**Frontend:** Cloudflare, connected to this repo. Build command
`npm run build`, output directory `dist`, and set `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY` as build environment variables (they're baked
into the bundle at build time).

**SPA routing is handled by the platform, not by a `_redirects` file.** Deep
links (`/orders/:accessToken`, `/dashboard`) must serve `index.html` rather than
404, or the customer order tracker breaks — it's reached by emailed link and
nothing else. Cloudflare's current Workers Assets platform does this via

```jsonc
"assets": { "not_found_handling": "single-page-application" }
```

which `wrangler` auto-detects for a Vite project and writes into a generated
`wrangler.jsonc` at build time. Real files still win, so `/assets/*` and
`/fonts/*` are unaffected.

⚠️ **Do not add a `public/_redirects` with `/*  /index.html  200`.** That was
the correct pattern on classic Cloudflare Pages, but the Workers Assets
validator now rejects it — `/index.html` itself matches `/*`, which it flags as
an infinite loop (`code: 100324`), and the whole deploy fails. This repo had one
briefly; it broke the first deploy and was removed.

Since the config is auto-detected rather than committed, **verify SPA routing
after any deploy** by hard-refreshing an `/orders/:token` URL. If it 404s, pin
the behaviour by committing a `wrangler.jsonc` with the `assets` block above —
note it also needs a `name` matching the Cloudflare project, so it has to be
updated if the project is ever recreated under a different name.

**Edge Functions:** `supabase functions deploy <name>`. These run on Supabase,
not Cloudflare — two deploy pipelines, deliberately (see ARCHITECTURE.md).

## Known gaps

- **Web Push (§17a)** — not built. No `push_subscriptions` table, no VAPID
  keys, no subscribe prompt. Its own self-contained piece of work, not a
  Milestone 6 addendum.
- **No route-level code splitting** — every page is statically imported in
  `App.tsx`, so a customer downloads the admin dashboard, the QR scanner and
  TanStack Table on first load (~794 KB). Lazy-loading the routes cuts the
  storefront's initial payload by roughly 20%.
- **No component or E2E tests** — `lib/` is well covered; the React layer is
  not. Deliberate, and still worth doing.
- **Product variants can't be deleted** — only renamed, repriced or added to.
  Orders, batches and stock rows reference them, so deleting one is a
  cascade nobody has designed yet. Deactivate the product instead.
- **Milestone 6 smoke tests** — a real phone + order-number recovery, an admin
  loading `/admin/audit-log`, and one manual `cleanup-payment-proofs` invoke
  have never been confirmed end-to-end.
