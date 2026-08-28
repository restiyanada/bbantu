import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Order access recovery (§16.2, Milestone 6, item 30) — the customer-facing
 * form for supabase/functions/recover-order-access.
 *
 * Deviates from §16.2's phone+email pair: this asks for phone + order
 * number instead (see the Edge Function's own comment for why) — the order
 * number is already shown on the order page and in every email, so it's
 * something a guest is realistically likely to still have even without
 * their original link.
 */

interface RecoveredOrder {
  orderNumber: string;
  fulfilmentMethod: string | null;
  status: string;
  createdAt: string;
  url: string;
}

type Status = "idle" | "submitting" | "found" | "not-found" | "error";

export default function FindOrderPage() {
  const [phone, setPhone] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveredOrder | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke("recover-order-access", {
      body: { phone: phone.trim(), orderNumber: orderNumber.trim() },
    });

    if (invokeError) {
      setStatus("error");
      // Deliberately generic — mirrors the same "don't reveal too much"
      // instinct as resubmit-payment/scan-pickup, and a 429 (rate limited)
      // shouldn't tell a guest anything more specific either.
      setError("We couldn't look that up right now. Please try again in a moment.");
      return;
    }

    if (data?.found && data.order) {
      setResult(data.order);
      setStatus("found");
    } else {
      setStatus("not-found");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Find my order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Lost your order link? Enter your phone number and your order number (shown on your order page and in
            your emails, e.g. #010007).
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="phone" className="text-sm font-medium">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="081234567890"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="orderNumber" className="text-sm font-medium">
                Order number
              </label>
              <input
                id="orderNumber"
                type="text"
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="#010007"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={status === "submitting"}>
              {status === "submitting" ? "Searching…" : "Find my order"}
            </Button>
          </form>

          {status === "not-found" && (
            <p className="text-sm text-muted-foreground">
              We couldn't find an order matching that phone number and order number. Double-check both against your
              order confirmation.
            </p>
          )}

          {status === "found" && result && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm font-medium">Found your order:</p>
              <a href={result.url} className="block rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <span className="font-medium">{result.orderNumber}</span>{" "}
                <span className="text-muted-foreground">
                  · {result.fulfilmentMethod?.toLowerCase() ?? "pending"} ·{" "}
                  {result.status.toLowerCase().replaceAll("_", " ")}
                </span>
              </a>
            </div>
          )}

          <p className="text-sm text-center">
            <Link to="/" className="text-blue-600 underline">
              Back home
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
