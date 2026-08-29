import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Renders a scannable QR code for the given value. Generated client-side —
 * cheap for a short token string, and needs no round trip to render.
 */
export function QrCode({ value, size = 200, className }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return <div className={className} style={{ width: size, height: size }} aria-hidden="true" />;
  }

  return <img src={dataUrl} alt={`QR code for pickup code ${value}`} width={size} height={size} className={className} />;
}
