import * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-sm font-medium leading-none select-none", className)}
      {...props}
    />
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive font-normal" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

function OptionalMark() {
  return <span className="text-muted-foreground font-normal"> (optional)</span>;
}

export { Label, RequiredMark, OptionalMark };
