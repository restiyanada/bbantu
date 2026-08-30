import * as React from "react";
import { cn } from "@/lib/utils";

// text-base (16px) on mobile, not text-sm (14px): any input font-size under
// 16px makes iOS Safari (and some Android browsers) zoom the whole page in
// on focus, forcing a manual pinch-zoom back out after every field. 16px+
// is the documented threshold that avoids it. md:text-sm keeps the tighter
// desktop density where that browser behavior doesn't apply.
const inputBase =
  "flex w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(inputBase, "h-9", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputBase, "min-h-16 resize-y", className)} {...props} />;
}

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="select" className={cn(inputBase, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export { Input, Textarea, Select, inputBase };
