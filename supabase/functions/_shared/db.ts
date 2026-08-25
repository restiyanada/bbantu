/**
 * Direct Postgres connection for Edge Functions — NOT the supabase-js/PostgREST
 * client used in `health/index.ts`. Order transitions (lib/orders.ts) need a
 * real multi-statement DB transaction (§20 — status change + audit row must
 * both happen or neither does), and PostgREST can't do that: each supabase-js
 * `.from().insert()` call is its own HTTP request. See architecture.md
 * "Order transitions need a real transaction" for the full reasoning.
 *
 * Requires a `DATABASE_URL` secret (the pooled Postgres connection string
 * from the Supabase project's Database settings), set via:
 *   supabase secrets set DATABASE_URL=postgres://...
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString = Deno.env.get("DATABASE_URL");
if (!connectionString) {
  throw new Error("DATABASE_URL must be set as a Supabase Edge Function secret.");
}

// prepare: false — required when connecting through Supabase's pooler
// (Supavisor/pgbouncer in transaction mode), which doesn't support
// prepared statements across pooled connections.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client);
