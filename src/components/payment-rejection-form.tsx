import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";

const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required."),
});

type RejectPaymentValues = z.infer<typeof rejectPaymentSchema>;

interface PaymentRejectionFormProps {
  onSubmit: (values: RejectPaymentValues) => void | Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
}

export function PaymentRejectionForm({
  onSubmit,
  onCancel,
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
      <div className="space-y-1.5">
        <Label htmlFor="reason">
          Rejection reason
          <RequiredMark />
        </Label>
        <Textarea
          id="reason"
          {...register("reason")}
          aria-invalid={!!errors.reason}
          rows={3}
          placeholder="e.g. Transfer amount doesn't match order total"
        />
        {errors.reason && (
          <p className="text-destructive text-xs">{errors.reason.message}</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="destructive" size="sm" disabled={submitting}>
          {submitting ? "Rejecting…" : "Reject payment"}
        </Button>
      </div>
    </form>
  );
}
