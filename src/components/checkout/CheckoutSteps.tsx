import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = ["Choose items", "Your details", "Review & pay"] as const;

export function CheckoutSteps({
  step,
  onStepClick,
}: {
  step: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "active" : "upcoming";
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              disabled={n > step}
              onClick={() => n < step && onStepClick(n)}
              className={cn(
                "flex items-center gap-2 shrink-0",
                n < step ? "cursor-pointer" : "cursor-default"
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "active" && "border-primary text-primary",
                  state === "upcoming" && "border-border text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : n}
              </span>
              <span
                className={cn(
                  "text-sm hidden sm:inline",
                  state === "active" ? "font-semibold" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </button>
            {n < STEPS.length && (
              <span className={cn("h-px flex-1 mx-2", n < step ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
