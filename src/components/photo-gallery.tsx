import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoGalleryProps {
  urls: string[];
  /** Describes the subject, for alt text: "Kaos Katun Combed". */
  label: string;
  className?: string;
}

/**
 * A swipeable photo strip. Swiping is a CSS scroll-snap track rather than a
 * drag handler, so it uses the browser's own momentum and rubber-banding and
 * behaves like every other horizontal scroller on the device. The arrows and
 * dots drive the same scroll, which is what makes it usable with a mouse or a
 * keyboard as well as a thumb.
 */
export function PhotoGallery({ urls, label, className }: PhotoGalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const scrollTo = useCallback((target: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(target, urls.length - 1));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }, [urls.length]);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setIndex((prev) => (prev === next ? prev : next));
  }

  if (urls.length === 0) {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageOff className="size-6" />
        <span className="text-xs">No photo</span>
      </div>
    );
  }

  const multiple = urls.length > 1;

  return (
    <div className={cn("relative bg-muted", className)}>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex aspect-[4/3] w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={urls.length === 1 ? label : `${label} — photo ${i + 1} of ${urls.length}`}
            className="h-full w-full shrink-0 snap-center object-cover"
            draggable={false}
          />
        ))}
      </div>

      {multiple && (
        <>
          <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-foreground/60 px-2.5 py-1 text-[11px] font-semibold leading-none text-background">
            {index + 1} / {urls.length}
          </div>

          <button
            type="button"
            onClick={() => scrollTo(index - 1)}
            disabled={index === 0}
            aria-label="Previous photo"
            className="absolute left-2.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 transition-opacity hover:bg-background disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollTo(index + 1)}
            disabled={index === urls.length - 1}
            aria-label="Next photo"
            className="absolute right-2.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 transition-opacity hover:bg-background disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronRight className="size-5" />
          </button>

          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {urls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Go to photo ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-4.5 bg-background" : "w-1.5 bg-background/55 hover:bg-background/80"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
