import { useRef, useState } from "react";
import { X } from "lucide-react";

interface ImageZoomProps {
  src: string;
  alt: string;
  className?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Renders `src` as a normal thumbnail; clicking it opens a full-screen
 * zoomable view — pinch (touch), scroll wheel (desktop trackpad/mouse), and
 * drag-to-pan once zoomed in. Built on pointer events rather than a library:
 * one gesture (pinch = two active pointers, pan = one) covers touch and
 * mouse identically, which is all a single static photo needs.
 */
export function ImageZoom({ src, alt, className }: ImageZoomProps) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  function reset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    pointers.current.clear();
  }

  function close() {
    setOpen(false);
    reset();
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale.current = scale;
    } else if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const currentDistance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDistance.current > 0) {
        setScale(clampScale(pinchStartScale.current * (currentDistance / pinchStartDistance.current)));
      }
    } else if (pointers.current.size === 1 && scale > 1) {
      setOffset({
        x: panStart.current.offsetX + (e.clientX - panStart.current.x),
        y: panStart.current.offsetY + (e.clientY - panStart.current.y),
      });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDistance.current = 0;
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale((prev) => clampScale(prev - e.deltaY * 0.01));
  }

  function handleDoubleClick() {
    if (scale > 1) {
      reset();
    } else {
      setScale(2.5);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 touch-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && scale === 1) close();
          }}
          onWheel={handleWheel}
        >
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-background/20 text-white hover:bg-background/30"
          >
            <X className="size-5" />
            <span className="sr-only">Close</span>
          </button>

          <img
            src={src}
            alt={alt}
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            className="max-h-full max-w-full select-none touch-none object-contain"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: pointers.current.size > 0 ? "none" : "transform 0.15s ease-out",
              cursor: scale > 1 ? "grab" : "zoom-in",
            }}
          />
        </div>
      )}
    </>
  );
}
