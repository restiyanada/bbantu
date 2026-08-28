/**
 * Renders the pure timeline data from src/lib/order-timeline.ts as a
 * vertical checklist — §16.3. Purely presentational: all the "which steps,
 * in what state" logic lives in buildOrderTimeline, so this component has
 * nothing to unit test beyond what's already covered there.
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderTimeline } from "@/lib/order-timeline";

export function OrderTimelineDisplay({ timeline }: { timeline: OrderTimeline }) {
  return (
    <div className="space-y-1">
      {timeline.steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
              step.state === "done" && "border-green-600 bg-green-600 text-white",
              step.state === "current" && "border-blue-600 text-blue-600 font-semibold",
              step.state === "upcoming" && "border-gray-300 text-gray-300"
            )}
          >
            {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-sm",
              step.state === "done" && "text-gray-700",
              step.state === "current" && "font-semibold text-blue-700",
              step.state === "upcoming" && "text-gray-400"
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
