import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogSheetContent, DialogTitle } from "@/components/ui/dialog";
import { PhotoGallery } from "@/components/photo-gallery";

interface ProductDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description?: string | null;
  photoUrls: string[];
  /** Right of the name — a price, or a price and quantity. */
  aside?: ReactNode;
  /** The part that differs between the storefront and the order tracker. */
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * The photo-and-details sheet, shared by the storefront (where the body picks
 * quantities) and the order tracker (where it is read-only).
 */
export function ProductDetailSheet({
  open,
  onOpenChange,
  name,
  description,
  photoUrls,
  aside,
  children,
  footer,
}: ProductDetailSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent>
        <div className="relative shrink-0">
          <PhotoGallery urls={photoUrls} label={name} />
          <DialogClose className="absolute left-2.5 top-2.5 flex size-9 items-center justify-center rounded-full bg-background/85 transition-colors hover:bg-background">
            <X className="size-4.5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="font-serif text-xl leading-tight font-semibold">{name}</DialogTitle>
            {aside}
          </div>

          {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}

          {children && (
            <>
              <div className="h-px bg-border" />
              {children}
            </>
          )}
        </div>

        {footer && <div className="shrink-0 border-t p-4">{footer}</div>}
      </DialogSheetContent>
    </Dialog>
  );
}
