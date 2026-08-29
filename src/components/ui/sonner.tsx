import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "bg-card! text-card-foreground! border! border-border! rounded-xl! shadow-lg! font-sans!",
          title: "font-medium!",
          description: "text-muted-foreground!",
          success: "[&_[data-icon]]:text-green-600!",
          error: "[&_[data-icon]]:text-destructive!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
