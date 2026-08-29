import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** Shown under the label — e.g. "JPG, PNG or WebP". */
  hint?: string;
}

/**
 * A visible file picker. The bare `<input type="file">` renders as unstyled
 * grey "Choose File / No file chosen" system chrome that reads as broken next
 * to the rest of the form, so the real input is hidden and the label is the
 * control. Keyboard and screen-reader behaviour are unchanged — the label
 * wraps the input, so focus, Space/Enter and `accept` all still work.
 */
export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(function FileInput(
  { className, hint, disabled, ...props },
  ref
) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input bg-background px-4 py-3 text-sm transition-colors",
        "hover:border-ring hover:bg-muted/50",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <Upload className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">Choose a file</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input ref={ref} type="file" disabled={disabled} className="sr-only" {...props} />
    </label>
  );
});
