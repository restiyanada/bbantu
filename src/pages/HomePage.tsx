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

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  phone: z.string().trim().min(1, "Phone number is required."),
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
  // Client-generated once per visit — the unique constraint on
  // orders.submission_token is what actually enforces "one order per
  // submit" (§19); this is just the value that gets reused if the button
  // is double-clicked, and swapped for a new one after a failed attempt.
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
      const { data, error } = await supabase
        .from("products")
        .select("id, name, description, product_variants(id, name, price)")
        .eq("active", true);

      if (cancelled) return;

      if (error) {
        setLoadError("Couldn't load products right now. Please try again shortly.");
        return;
      }
      setProducts((data as ProductRow[] | null) ?? []);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

    const { data, error } = await supabase.functions.invoke("create-order", {
      body: { customer, items, submissionToken },
    });

    if (error || !data) {
      setSubmitError(
        (data as { error?: string } | null)?.error ?? "Something went wrong placing your order. Please try again."
      );
      // A fresh token for the retry avoids any ambiguity about whether the
      // failed attempt's token might be considered used server-side.
      setSubmissionToken(crypto.randomUUID());
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

            <Button type="submit" disabled={isSubmitting || products === null || products.length === 0}>
              {isSubmitting ? "Placing order…" : "Place order"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
