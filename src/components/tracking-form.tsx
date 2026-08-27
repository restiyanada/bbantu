import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";

// §26 "Shipping cost can be manually corrected, but the override must be
// audited" — costOverrideReason is required whenever costOverride is
// filled in, same shape as rejectPaymentSchema requiring a reason. Both are
// optional together — most orders will just record a tracking number with
// no cost change at all.
const recordTrackingSchema = z
  .object({
    trackingNumber: z.string().trim().min(1, "Tracking number is required."),
    costOverride: z.string().trim().optional(),
    costOverrideReason: z.string().trim().optional(),
  })
  .refine((val) => !val.costOverride || (val.costOverrideReason ?? "").length > 0, {
    message: "A reason is required when overriding the shipping cost.",
    path: ["costOverrideReason"],
  });

export type RecordTrackingValues = z.infer<typeof recordTrackingSchema>;

interface TrackingFormProps {
  currentCost: string | null;
  onSubmit: (values: RecordTrackingValues) => void | Promise<void>;
  submitting?: boolean;
}

export function TrackingForm({ currentCost, onSubmit, submitting }: TrackingFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecordTrackingValues>({ resolver: zodResolver(recordTrackingSchema) });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2 w-64">
      <div>
        <label className="text-xs font-medium">Tracking number</label>
        <input
          {...register("trackingNumber")}
          className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {errors.trackingNumber && (
          <p className="text-destructive text-xs mt-1">{errors.trackingNumber.message}</p>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500">Override cost (currently {currentCost ?? "—"})</summary>
        <div className="mt-2 space-y-2">
          <input
            {...register("costOverride")}
            placeholder="New cost (IDR)"
            inputMode="decimal"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          <input
            {...register("costOverrideReason")}
            placeholder="Reason (required if overriding)"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          {errors.costOverrideReason && (
            <p className="text-destructive text-xs">{errors.costOverrideReason.message}</p>
          )}
        </div>
      </details>
      <Button type="submit" size="sm" variant="success" disabled={submitting}>
        {submitting ? "Saving…" : "Mark shipped"}
      </Button>
    </form>
  );
}
