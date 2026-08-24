import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";

// §8.3: "Rejection reason — Required when rejected." This schema is the
// actual enforcement of that rule on the client side (the Edge Function
// that performs the rejection re-validates it server-side too — a browser
// check alone is never sufficient, per §3 principle 5).
const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required."),
});

type RejectPaymentValues = z.infer<typeof rejectPaymentSchema>;

interface PaymentRejectionFormProps {
  onSubmit: (values: RejectPaymentValues) => void | Promise<void>;
  submitting?: boolean;
}

export function PaymentRejectionForm({
  onSubmit,
  submitting,
}: PaymentRejectionFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectPaymentValues>({
    resolver: zodResolver(rejectPaymentSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div>
        <label htmlFor="reason" className="text-sm font-medium">
          Rejection reason
        </label>
        <textarea
          id="reason"
          {...register("reason")}
          rows={3}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder="e.g. Transfer amount doesn't match order total"
        />
        {errors.reason && (
          <p className="text-destructive text-xs mt-1">{errors.reason.message}</p>
        )}
      </div>
      <Button type="submit" variant="destructive" disabled={submitting}>
        {submitting ? "Rejecting…" : "Reject payment"}
      </Button>
    </form>
  );
}
