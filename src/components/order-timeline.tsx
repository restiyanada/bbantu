import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderTimeline } from "@/lib/order-timeline";

export function OrderTimelineDisplay({ timeline }: { timeline: OrderTimeline }) {
  return (
    <div>
      {timeline.steps.map((step, i) => (
        <div key={step.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                step.state === "done" && "border-primary bg-primary text-primary-foreground",
                step.state === "current" && "border-primary text-primary font-semibold shadow-[0_0_0_3px_var(--color-accent)]",
                step.state === "upcoming" && "border-border text-muted-foreground"
              )}
            >
              {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            {i < timeline.steps.length - 1 && (
              <span
                className={cn("w-px flex-1 min-h-4", step.state === "done" ? "bg-primary" : "bg-border")}
              />
            )}
          </div>
          <span
            className={cn(
              "text-sm pb-3",
              step.state === "done" && "text-foreground",
              step.state === "current" && "font-semibold text-primary",
              step.state === "upcoming" && "text-muted-foreground"
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
      {timeline.terminalNote && (
        <div className="flex items-center gap-3 pt-1">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-white",
              timeline.terminalNote.tone === "cancelled" ? "bg-red-600" : "bg-amber-600"
            )}
          >
            !
          </span>
          <span
            className={cn(
              "text-sm font-semibold",
              timeline.terminalNote.tone === "cancelled" ? "text-red-700" : "text-amber-700"
            )}
          >
            {timeline.terminalNote.label}
          </span>
        </div>
      )}
    </div>
  );
}
