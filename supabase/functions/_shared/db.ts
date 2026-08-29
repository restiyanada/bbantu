import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString = Deno.env.get("DATABASE_URL");
if (!connectionString) {
  throw new Error("DATABASE_URL must be set as a Supabase Edge Function secret.");
}

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client);
