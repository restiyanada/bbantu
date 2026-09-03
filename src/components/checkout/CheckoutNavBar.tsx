import { Button } from "@/components/ui/button";

export function CheckoutNavBar({
  step,
  cartCount,
  subtotal,
  continueDisabled,
  submitDisabled,
  isSubmitting,
  onBack,
  onContinue,
}: {
  step: number;
  cartCount: number;
  subtotal: string;
  continueDisabled: boolean;
  submitDisabled: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-card border-t z-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
        {step === 1 ? (
          <div>
            <p className="text-xs text-muted-foreground">{cartCount} item(s)</p>
            <p className="text-base font-bold">{subtotal}</p>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        )}

        {step === 1 && (
          <Button type="button" onClick={onContinue} disabled={continueDisabled}>
            Continue
          </Button>
        )}
        {step === 2 && (
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        )}
        {step === 3 && (
          <Button type="submit" disabled={isSubmitting || submitDisabled}>
            {isSubmitting ? "Placing order…" : "Place order"}
          </Button>
        )}
      </div>
    </div>
  );
}
