import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { pushSubscriptions } from "../../../db/schema.ts";

// No auth check: the endpoint URL itself is an unguessable per-browser secret
// (assigned by the push service), so knowing it is already proof this is your
// own subscription. Deleting one that isn't yours does nothing harmful — it
// just stops notifications nobody but the real owner's browser could unwrap
// anyway (the payload is encrypted to keys only that browser holds).
const unsubscribeSchema = z.object({ endpoint: z.string().trim().min(1) });

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof unsubscribeSchema>;
  try {
    input = unsubscribeSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
    return json({ unsubscribed: true });
  } catch (err) {
    return errorResponse(err, "Unexpected error unsubscribing from push notifications.");
  }
});
