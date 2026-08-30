import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString = Deno.env.get("DATABASE_URL");
if (!connectionString) {
  throw new Error("DATABASE_URL must be set as a Supabase Edge Function secret.");
}

// statement_timeout is a last-resort backstop, not a tight budget — every
// legitimate query/transaction in this app finishes in well under a second.
// Its job is to guarantee that no single query can hang a function
// indefinitely (e.g. unexpected lock contention), the same class of bug that
// let an untimed-out push send block prepare-pickup for minutes.
const client = postgres(connectionString, { prepare: false, connection: { statement_timeout: 15000 } });

export const db = drizzle(client);
