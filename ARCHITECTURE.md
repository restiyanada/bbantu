# Architecture

Running log of *why* this project is built the way it is. The PRD (`preorder_ready_stock_system_PRD_v1_2.html`)
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

PRD §18