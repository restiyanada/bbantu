import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "rounded-full bg-primary text-primary-foreground hover:opacity-85",
        destructive:
          "rounded-full bg-destructive text-white hover:bg-destructive/90",
        success: "rounded-full bg-green-700 text-white hover:bg-green-700/90",
        info: "rounded-full bg-brand text-white hover:bg-brand/90",
        outline:
          "rounded-full border-[1.5px] bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "rounded-md hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline-offset-4 hover:underline font-semibold",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-11 px-8 text-[15px]",
        icon: "size-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
