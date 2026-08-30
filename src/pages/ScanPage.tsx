import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatOrderNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AdminLayout from "@/components/AdminLayout";

interface ScanResult {
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  customerPhoneMasked: string | null;
  items: { name: string; quantity: number }[];
  paymentStatus: string | null;
  orderStatus: string;
  eligibleForPickup: boolean;
  alreadyPickedUp: boolean;
  confirmed: boolean;
}

interface PhoneMatch {
  orderId: string;
  orderNumber: number | null;
  pickupToken: string;
  customerName: string;
}

export default function ScanPage() {
  const { admin } = useAdminAuth();
  const canScan = admin?.canScanConfirmPickup ?? false;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [currentToken, setCurrentToken] = useState<string | null>(null);

  const [phoneQuery, setPhoneQuery] = useState("");
  const [phoneMatches, setPhoneMatches] = useState<PhoneMatch[] | null>(null);
  const [phoneSearching, setPhoneSearching] = useState(false);

  async function lookupToken(token: string) {
    setLookupError(null);
    const { data, error } = await supabase.functions.invoke("scan-pickup", {
      body: { token },
    });
    if (error || !data) {
      setLookupError((data as { error?: string } | null)?.error ?? "Invalid pickup code.");
      return;
    }
    setCurrentToken(token);
    setResult(data as ScanResult);
    setPhoneMatches(null);
  }

  useEffect(() => {
    if (!videoRef.current || !canScan) return;

    const scanner = new QrScanner(
      videoRef.current,
      (scanResult) => {
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
  }, [canScan]);

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
    setPhoneMatches(null);
    setPhoneQuery("");
    void scannerRef.current?.start();
  }

  function handleManualLookup() {
    if (!manualToken.trim()) return;
    scannerRef.current?.pause();
    void lookupToken(manualToken.trim());
  }

  async function handlePhoneSearch() {
    if (!phoneQuery.trim()) return;
    setLookupError(null);
    setPhoneSearching(true);
    scannerRef.current?.pause();
    const { data, error } = await supabase.functions.invoke("scan-pickup", {
      body: { phone: phoneQuery.trim() },
    });
    setPhoneSearching(false);
    if (error || !data) {
      setLookupError("Couldn't search by phone number.");
      return;
    }
    const matches = (data as { matches: PhoneMatch[] }).matches;
    if (matches.length === 0) {
      setLookupError("No orders ready for pickup found for that phone number.");
      return;
    }
    setPhoneMatches(matches);
  }

  return (
    <AdminLayout>
      <main className="p-4 sm:p-8 max-w-md mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pickup Scanner</h1>
          <p className="text-muted-foreground mt-1 text-sm">Point the camera at the customer's pickup code.</p>
        </div>

        {!canScan && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive">
              You don't have the "Scan / confirm pickup" permission. The camera and lookup below are
              disabled — ask an admin with this permission to grant it if you need to use this page.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <video ref={videoRef} className="w-full rounded-lg bg-black aspect-square object-cover" />
            {cameraError && <p className="text-destructive text-sm mt-2">{cameraError}</p>}
          </CardContent>
        </Card>

        {!result && !phoneMatches && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Camera not working?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value.toUpperCase())}
                  placeholder="Paste pickup code"
                  disabled={!canScan}
                  className="flex-1 uppercase placeholder:normal-case"
                />
                <Button disabled={!canScan} onClick={handleManualLookup}>
                  Look up
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">— or find by phone number —</p>
              <div className="flex gap-2">
                <Input
                  value={phoneQuery}
                  onChange={(e) => setPhoneQuery(e.target.value)}
                  placeholder="Customer phone number"
                  disabled={!canScan}
                  className="flex-1"
                />
                <Button variant="outline" disabled={!canScan || phoneSearching} onClick={handlePhoneSearch}>
                  {phoneSearching ? "Searching…" : "Search"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phoneMatches && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Select the right order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {phoneMatches.map((match) => (
                <button
                  key={match.orderId}
                  type="button"
                  onClick={() => lookupToken(match.pickupToken)}
                  className="w-full text-left flex justify-between items-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <span>{match.customerName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatOrderNumber("PICKUP", match.orderNumber, match.orderId)}
                  </span>
                </button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setPhoneMatches(null)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        {lookupError && <p className="text-destructive text-sm">{lookupError}</p>}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Order {formatOrderNumber("PICKUP", result.orderNumber, result.orderId)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p>
                  <span className="font-medium">{result.customerName}</span> · {result.customerPhoneMasked}
                </p>
                {result.items.map((item, i) => (
                  <p key={i} className="text-muted-foreground">
                    {item.name} × {item.quantity}
                  </p>
                ))}
                <p className="text-muted-foreground">Payment: {result.paymentStatus?.toLowerCase()}</p>
              </div>

              {result.alreadyPickedUp && result.confirmed && (
                <p className="text-green-700 font-medium">Pickup confirmed.</p>
              )}
              {result.alreadyPickedUp && !result.confirmed && (
                <p className="text-destructive font-medium">Already picked up — cannot release again.</p>
              )}
              {result.eligibleForPickup && !result.confirmed && (
                <Button variant="success" onClick={handleConfirm} disabled={confirming || !canScan}>
                  {confirming ? "Confirming…" : "Confirm pickup"}
                </Button>
              )}
              {!result.eligibleForPickup && !result.alreadyPickedUp && (
                <p className="text-muted-foreground">This order isn't ready for pickup yet ({result.orderStatus}).</p>
              )}

              <Button variant="outline" onClick={handleScanNext}>
                Scan next
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </AdminLayout>
  );
}
