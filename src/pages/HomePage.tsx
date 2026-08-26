import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface VariantRow {
  id: string;
  name: string;
  price: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  product_variants: VariantRow[];
}

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

const PROOF_BUCKET = "payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB, matches supabase/storage_setup.sql
const ACCEPTED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// Same patterns as create-order's server-side validation — this is the UX
// nicety only; the Edge Function re-validates identically (§3 principle 5).
const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
const PHONE_PATTERN = /^[0-9]{8,15}$/;

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
  email: z.string().trim().email("A valid email is required."),
});

type CustomerValues = z.infer<typeof customerSchema>;

export default function HomePage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsRow | null>(null);

  // Payment proof upload state. `proofPath` is what actually gets sent to
  // create-order — a Storage path within PROOF_BUCKET, not a public URL (the
  // bucket has no public read at all, see supabase/storage_setup.sql).
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  // Client-generated once per visit — the unique constraint on
  // orders.submission_token is what actually enforces "one order per
  // submit" (§19); this is just the value that gets reused if the button
  // is double-clicked, and swapped for a new one after a failed attempt.
  // Also used as the upload path prefix, so a proof can be uploaded before
  // the order (and its id) exists yet.
  const [submissionToken, setSubmissionToken] = useState(() => crypto.randomUUID());

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({ resolver: zodResolver(customerSchema) });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Products/variants have no RLS (public storefront catalog, §5) — a
      // plain read, not something that needs the guest order-access token.
      const [productsResult, settingsResult] = await Promise.all([
        supabase.from("products").select("id, name, description, product_variants(id, name, price)").eq("active", true),
        supabase.from("payment_settings").select("bank_name, account_number, account_holder_name").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      if (productsResult.error) {
        setLoadError("Couldn't load products right now. Please try again shortly.");
      } else {
        setProducts((productsResult.data as ProductRow[] | null) ?? []);
      }
      setPaymentSettings((settingsResult.data as PaymentSettingsRow | null) ?? null);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const subtotalCents =
    products?.reduce(
      (sum, product) =>
        sum +
        product.product_variants.reduce(
          (s, variant) => s + (quantities[variant.id] ?? 0) * Math.round(Number(variant.price) * 100),
          0
        ),
      0
    ) ?? 0;
  const hasItems = subtotalCents > 0;
  const subtotal = (subtotalCents / 100).toFixed(2);

  // M1 scope only ever creates FULL-payment orders (DP arrives in
  // Milestone 2) — written to branch on paymentType now anyway, so the DP
  // wording doesn't need writing from scratch later, even though only
  // "FULL" is reachable today.
  const paymentType = "FULL" as "FULL" | "DP";
  const depositCents = Math.round(subtotalCents * 0.5);
  const amountDueNowCents = paymentType === "DP" ? depositCents : subtotalCents;

  async function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofError(null);
    setProofPath(null);

    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setProofError("Please upload a JPEG, PNG, WebP image, or a PDF.");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setProofError("File is too large — please keep it under 5MB.");
      return;
    }

    setProofUploading(true);
    const path = `${submissionToken}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type });
    setProofUploading(false);

    if (error) {
      setProofError("Couldn't upload your payment proof. Please try again.");
      return;
    }
    setProofPath(path);
    setProofFileName(file.name);
  }

  async function onSubmit(customer: CustomerValues) {
    setSubmitError(null);
    setItemsError(null);

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));

    if (items.length === 0) {
      setItemsError("Add at least one item before placing your order.");
      return;
    }
    if (!proofPath) {
      setProofError("Please upload your payment proof before submitting.");
      return;
    }

    const { data, error } = await supabase.functions.invoke("create-order", {
      body: { customer, items, submissionToken, proofFileUrl: proofPath },
    });

    if (error || !data) {
      setSubmitError(
        (data as { error?: string } | null)?.error ?? "Something went wrong placing your order. Please try again."
      );
      // A fresh token for the retry avoids any ambiguity about whether the
      // failed attempt's token might be considered used server-side. The
      // already-uploaded proof stays valid (it's keyed by the old token's
      // folder), but the new submission needs a token of its own too, so
      // simplest is to ask for a fresh upload alongside the fresh token.
      setSubmissionToken(crypto.randomUUID());
      setProofPath(null);
      setProofFileName(null);
      return;
    }

    navigate(`/orders/${data.accessToken}`);
  }

  return (
    <main className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pre-Order &amp; Ready Stock System</h1>
        <p className="text-gray-500 mt-1">Pick an item, enter your details, and place your order.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p className="text-destructive text-sm">{loadError}</p>}
          {!loadError && products === null && <p className="text-gray-500 text-sm">Loading items…</p>}
          {products !== null && products.length === 0 && (
            <p className="text-gray-500 text-sm">Nothing available to order right now.</p>
          )}
          {products?.map((product) => (
            <div key={product.id} className="space-y-2">
              <div>
                <p className="font-medium">{product.name}</p>
                {product.description && <p className="text-sm text-gray-500">{product.description}</p>}
              </div>
              {product.product_variants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between text-sm pl-3">
                  <span>
                    {variant.name} — {formatIDR(variant.price)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={quantities[variant.id] ?? 0}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [variant.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-16 rounded-md border bg-background px-2 py-1 text-sm text-right"
                  />
                </div>
              ))}
            </div>
          ))}
          {itemsError && <p className="text-destructive text-sm">{itemsError}</p>}
        </CardContent>
      </Card>

      {hasItems && (
        <Card>
          <CardHeader>
            <CardTitle>Order summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span>Order total</span>
              <span className="font-medium">{formatIDR(subtotal)}</span>
            </div>

            {paymentType === "DP" ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="font-medium text-amber-900">This is a deposit (DP) order.</p>
                <div className="flex justify-between text-amber-900">
                  <span>Pay now (50% deposit)</span>
                  <span className="font-semibold">{formatIDR((depositCents / 100).toFixed(2))}</span>
                </div>
                <div className="flex justify-between text-amber-800">
                  <span>Remaining balance (due later, once ready)</span>
                  <span>{formatIDR(((subtotalCents - depositCents) / 100).toFixed(2))}</span>
                </div>
                <p className="text-xs text-amber-700 pt-1">
                  You'll be notified when the remaining balance is due — you don't need to pay it now.
                </p>
              </div>
            ) : (
              <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                <p className="font-medium text-blue-900">You're paying the full amount now.</p>
                <div className="flex justify-between text-blue-900 mt-1">
                  <span>Amount to transfer</span>
                  <span className="font-semibold">{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
                </div>
              </div>
            )}

            {paymentSettings ? (
              <div className="pt-2 mt-2 border-t space-y-1">
                <p className="text-gray-500">Transfer to:</p>
                <p>
                  <span className="font-medium">{paymentSettings.bank_name}</span> — {paymentSettings.account_number}
                </p>
                <p className="text-gray-500">a.n. {paymentSettings.account_holder_name}</p>
              </div>
            ) : (
              <p className="text-gray-500 pt-2 mt-2 border-t">
                Bank account details aren't configured yet — contact us before paying.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {hasItems && (
        <Card>
          <CardHeader>
            <CardTitle>Payment proof</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-500">
              Upload a screenshot or PDF of your transfer receipt for the amount shown above.
            </p>
            <input
              type="file"
              accept={ACCEPTED_PROOF_TYPES.join(",")}
              onChange={handleProofFileChange}
              disabled={proofUploading}
              className="text-sm"
            />
            {proofUploading && <p className="text-sm text-gray-500">Uploading…</p>}
            {proofPath && !proofUploading && (
              <p className="text-sm text-green-700">Uploaded: {proofFileName}</p>
            )}
            {proofError && <p className="text-destructive text-sm">{proofError}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                {...register("name")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="phone" className="text-sm font-medium">
                Phone number
              </label>
              <input
                id="phone"
                {...register("phone")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.phone && <p className="text-destructive text-xs mt-1">{errors.phone.message}</p>}
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                {...register("email")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.email && <p className="text-destructive text-xs mt-1">{errors.email.message}</p>}
            </div>

            {submitError && <p className="text-destructive text-sm">{submitError}</p>}

            <Button
              type="submit"
              disabled={isSubmitting || products === null || products.length === 0 || !proofPath || proofUploading}
            >
              {isSubmitting ? "Placing order…" : "Place order"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
