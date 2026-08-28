import { cn } from "@/lib/utils";

interface FileUploadPreviewProps {
  previewUrl: string;
  label: string;
  onRemove: () => void;
  className?: string;
}

export function FileUploadPreview({ previewUrl, label, onRemove, className }: FileUploadPreviewProps) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border p-2 text-sm", className)}>
      <img src={previewUrl} alt="" className="h-10 w-10 rounded object-cover border shrink-0" />
      <span className="flex-1 truncate text-green-700">{label}</span>
      <button type="button" onClick={onRemove} className="text-xs text-destructive underline shrink-0">
        Remove
      </button>
    </div>
  );
}
