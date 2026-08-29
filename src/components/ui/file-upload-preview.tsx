import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FileUploadPreviewProps {
  previewUrl: string;
  label: string;
  onRemove: () => void;
  className?: string;
}

export function FileUploadPreview({ previewUrl, label, onRemove, className }: FileUploadPreviewProps) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border bg-card p-2 text-sm", className)}>
      <img src={previewUrl} alt="" className="h-10 w-10 rounded-md object-cover border shrink-0" />
      <span className="flex-1 truncate text-green-700 font-medium">{label}</span>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} className="text-destructive hover:text-destructive shrink-0">
        <X className="size-3.5" />
        Remove
      </Button>
    </div>
  );
}
