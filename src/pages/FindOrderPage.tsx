import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";

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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Phone number
                <RequiredMark />
              </Label>
              <Input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081234567890"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orderNumber">
                Order number
                <RequiredMark />
              </Label>
              <Input
                id="orderNumber"
                type="text"
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
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

          <Button asChild size="sm" variant="ghost" className="w-full">
            <Link to="/">
              <ArrowLeft className="size-3.5" />
              Back home
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
