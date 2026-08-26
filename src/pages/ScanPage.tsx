import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ⚠️ NOT SECURE YET — matches scan-pickup's own caveat: no staff-session
// auth check exists yet (Milestone 4). §13.3 wants an unauthenticated scan
// to see only "Login required" — until real auth exists, this page just
// shows real order data to anyone who opens it. Don't link this page
// anywhere public yet.

interface ScanResult {
  orderId: string;
  customerName: string | null;
  customerPhoneMasked: string | null;
  items: { name: string; quantity: number }[];
  paymentStatus: string | null;
  orderStatus: string;
  eligibleForPickup: boolean;
  alreadyPickedUp: boolean;
  confirmed: boolean;
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [currentToken, setCurrentToken] = useState<string | null>(null);

  async function lookupToken(token: string) {
    setLookupError(null);
    const { data, error } = await supabase.functions.invoke("scan-pickup", {
      body: { token },
    });
    if (error || !data) {
      setLookupError((data as { error?: string } | null)?.error ?? "Invalid QR code.");
      return;
    }
    setCurrentToken(token);
    setResult(data as ScanResult);
  }

  useEffect(() => {
    if (!videoRef.current) return;

    const scanner = new QrScanner(
      videoRef.current,
      (scanResult) => {
        // Pause immediately on a hit so the same code isn't re-processed
        // every frame while we look it up / show the result.
        void scanner.pause();
        void lookupToken(scanResult.data);
      },
      { returnDetailedScanResult: true, highlightScanRegion: true }
    );
    scannerRef.current = scanner;

    scanner.start().catch(() => {
      setCameraError("Couldn't access the camera. You can still look up a code manually below.");
    });

    return () => {
      scanner.stop();
      scanner.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    if (!currentToken) return;
    setConfirming(true);
    const { data, error } = await supabase.functions.invoke("scan-pickup", {
      body: { token: currentToken, confirm: true },
    });
    setConfirming(false);
    if (error || !data) {
      setLookupError((data as { error?: string } | null)?.error ?? "Couldn't confirm pickup.");
      return;
    }
    setResult(data as ScanResult);
  }

  function handleScanNext() {
    setResult(null);
    setLookupError(null);
    setCurrentToken(null);
    void scannerRef.current?.start();
  }

  function handleManualLookup() {
    if (!manualToken.trim()) return;
    scannerRef.current?.pause();
    void lookupToken(manualToken.trim());
  }

  return (
    <main className="p-8 max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pickup Scanner</h1>
        <p className="text-gray-500 mt-1 text-sm">Point the camera at the customer's pickup QR code.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <video ref={videoRef} className="w-full rounded-md bg-black aspect-square object-cover" />
          {cameraError && <p className="text-destructive text-sm mt-2">{cameraError}</p>}
        </CardContent>
      </Card>

      {!result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Camera not working?</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <input
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Paste pickup code"
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button onClick={handleManualLookup}>Look up</Button>
          </CardContent>
        </Card>
      )}

      {lookupError && <p className="text-destructive text-sm">{lookupError}</p>}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Order {result.orderId.slice(0, 8)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p>
                <span className="font-medium">{result.customerName}</span> · {result.customerPhoneMasked}
              </p>
              {result.items.map((item, i) => (
                <p key={i} className="text-gray-500">
                  {item.name} × {item.quantity}
                </p>
              ))}
              <p className="text-gray-500">Payment: {result.paymentStatus?.toLowerCase()}</p>
            </div>

            {result.alreadyPickedUp && result.confirmed && (
              <p className="text-green-700 font-medium">Pickup confirmed.</p>
            )}
            {result.alreadyPickedUp && !result.confirmed && (
              <p className="text-destructive font-medium">Already picked up — cannot release again.</p>
            )}
            {result.eligibleForPickup && !result.confirmed && (
              <Button onClick={handleConfirm} disabled={confirming}>
                {confirming ? "Confirming…" : "Confirm pickup"}
              </Button>
            )}
            {!result.eligibleForPickup && !result.alreadyPickedUp && (
              <p className="text-gray-500">This order isn't ready for pickup yet ({result.orderStatus}).</p>
            )}

            <Button variant="outline" onClick={handleScanNext}>
              Scan next
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
