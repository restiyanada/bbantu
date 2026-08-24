# Pre-Order & Ready Stock System

Scaffold only — folder structure, DB schema, and wiring. No business logic yet.

## Stack

- **Frontend:** Vite + React (SPA) + Tailwind, hosted on Cloudflare Pages
- **Admin UI:** shadcn/ui (Button, Badge, Card hand-authored — see note below),
  TanStack Table v8 for order/data lists, React Hook Form + Zod for forms
- **Testing:** Vitest — currently covers `lib/order-state-machine.ts` only
  (nothing else has real logic yet)
- **Backend logic:** Supabase Edge Functions (Deno) — anything that must bypass
  Row Level Security (payment verification, order status changes, inventory
  allocation) lives here, never as a direct write from the browser
- **Database:** Supabase Postgres, schema defined and pushed via Drizzle
- **Auth:** Supabase Auth (magic link) for admin staff; secure tokens for guest
  order access (§16, §27) — these are separate systems, not the same thing
- **Email:** Resend, called from an Edge Function

## About the admin UI components

`components.json` is set up for the real shadcn/ui CLI, but `npx shadcn init`
couldn't run in the sandbox that built this scaffold (network-restricted,
couldn't reach `ui.shadcn.com` — not a real auth requirement, just a sandbox
limit). So `Button`, `Badge`, and `Card` in `src/components/ui/` were
hand-written to match exactly what the CLI would generate. Once you're in
Codespaces (full internet access), pull any additional components you need
the normal way:

```bash
npx shadcn@latest add dialog dropdown-menu input label table
```

They'll slot in alongside the existing ones with no conflicts.

## Why this shape

There's no server sitting between the browser and the database anymore (no
Next.js API routes). That means **Row Level Security policies + Edge
Functions are the enforcement boundary** that PRD §3 principle 5 requires
("backend is the source of truth"). The browser talks to Supabase directly
for reads via `src/lib/supabaseClient.ts`, using the low-privilege publishable
key. Anything that changes state goes through an Edge Function using the
service role key instead — see `supabase/functions/health/index.ts` for the
pattern.

## Folder structure

```
src/
  pages/               ← route components (HomePage, OrderPage, AdminDashboardPage)
  components/ui/       ← shadcn/ui primitives (Button, Badge, Card)
  components/          ← app components (payment-rejection-form.tsx — real
                          example wiring React Hook Form + Zod to §8.3's
                          "rejection reason required" rule)
  lib/supabaseClient.ts ← browser-side Supabase client (publishable key only)
  lib/utils.ts          ← shadcn's cn() class-merging helper
  App.tsx              ← route definitions
db/
  schema.ts            ← all tables (PRD §21 domain model) — unchanged from before
lib/
  order-state-machine.ts      ← pure order status transition logic
  order-state-machine.test.ts ← Vitest suite: both §32 acceptance scenarios,
                                 ready-stock fast paths, §26 cancellation rules
supabase/
  functions/health/    ← example Edge Function (service role key, bypasses RLS)
  config.toml
drizzle.config.ts       ← schema push config, uses PG* env vars
components.json         ← shadcn/ui CLI config (for adding more components later)
```

## First-time setup

1. **Install the Supabase CLI** (needed to run/deploy Edge Functions):
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref lhvxjgbjjamwatsmxiyc
   ```

2. Copy `.env.example` to `.env.local` and fill in:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase → Project
     Settings → API
   - `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` — Supabase → Connect →
     Session pooler (needed for `db:push` only, not shipped to the browser)

3. Install dependencies and push the schema (this part is unchanged from
   before — same database, same schema, same tables already created if
   you've done this once):
   ```bash
   npm install
   npm run db:push
   ```

4. Run the frontend locally:
   ```bash
   npm run dev
   ```

5. Run the Edge Function locally and test it:
   ```bash
   supabase functions serve health
   curl http://localhost:54321/functions/v1/health
   ```
   Should return `{"status":"ok","db":"connected"}`.

## Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local Vite dev server |
| `npm run build` | Production build (outputs to `dist/`) |
| `npm run test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode while developing |
| `npm run db:push` | Push schema changes to Supabase |
| `npm run db:studio` | Browse data in Drizzle Studio |
| `supabase functions serve <name>` | Run an Edge Function locally |
| `supabase functions deploy <name>` | Deploy an Edge Function |
| `supabase secrets set KEY=value` | Set a secret for Edge Functions (e.g. `RESEND_API_KEY`) |

## Deploying

**Frontend:** push this repo to GitHub, connect it in Cloudflare Pages
(Framework preset: Vite, build command `npm run build`, output directory
`dist`). No adapter needed — it's a static build.

**Edge Functions:** `supabase functions deploy <name>` from your machine or CI.
These run on Supabase's infrastructure, not Cloudflare.

## Not built yet

This is scaffolding only. Not implemented: order state machine wiring into
real endpoints, RLS policies, payment verification, email queue, QR pickup
scanning, shipping label generation, admin auth. See the PRD for scope.
