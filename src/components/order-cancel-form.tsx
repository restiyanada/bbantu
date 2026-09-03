import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";

const cancelOrderSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation reason is required."),
});

type CancelOrderValues = z.infer<typeof cancelOrderSchema>;

interface OrderCancelFormProps {
  onSubmit: (values: CancelOrderValues) => void | Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
}

export function OrderCancelForm({
  onSubmit,
  onCancel,
  submitting,
}: OrderCancelFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelOrderValues>({
    resolver: zodResolver(cancelOrderSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reason">
          Cancellation reason
          <RequiredMark />
        </Label>
        <Textarea
          id="reason"
          {...register("reason")}
          aria-invalid={!!errors.reason}
          rows={3}
          placeholder="e.g. Customer requested cancellation"
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
          {submitting ? "Cancelling…" : "Cancel order"}
        </Button>
      </div>
    </form>
  );
}
