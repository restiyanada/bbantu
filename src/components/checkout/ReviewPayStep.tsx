import { formatIDR } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/fileUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";
import { FileInput } from "@/components/ui/file-input";
import type { ProofUpload } from "@/lib/useProofUpload";
import type { JneRateOption } from "@/lib/useShippingSelection";
import type { SelectableItem } from "@/components/checkout/ChooseItemsStep";

export interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

export function ReviewPayStep(props: {
  activeItems: SelectableItem[];
  quantities: Record<string, number>;
  subtotalCents: number;
  shippingCostCents: number;
  amountDueNowCents: number;
  grandTotalCents: number;
  effectivePaymentType: "DP" | "FULL";
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  paymentSettings: PaymentSettingsRow | null;
  proof: ProofUpload;
  submitError: string | null;
  /** The rate the customer picked, if any — carries the service name and raw
   *  price the summary displays; not reconstructable from shippingCostCents
   *  alone. See task-9-10-report.md for why this was added. */
  selectedRate: JneRateOption | null;
}) {
  const {
    activeItems,
    quantities,
    subtotalCents,
    amountDueNowCents,
    grandTotalCents,
    effectivePaymentType,
    fulfilmentMethod,
    paymentSettings,
    proof,
    submitError,
    selectedRate,
  } = props;

  const subtotal = (subtotalCents / 100).toFixed(2);
  const depositCents = Math.round(subtotalCents * 0.5);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Order summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            {activeItems
              .filter((item) => (quantities[item.variantId] ?? 0) > 0)
              .map((item) => (
                <div key={item.variantId} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {item.label} × {quantities[item.variantId]}
                  </span>
                  <span>{formatIDR((Number(item.price) * quantities[item.variantId]).toFixed(2))}</span>
                </div>
              ))}
          </div>
          <div className="flex justify-between pt-1 border-t">
            <span>Merchandise subtotal</span>
            <span className="font-medium">{formatIDR(subtotal)}</span>
          </div>
          {fulfilmentMethod === "SHIPPING" && selectedRate && (
            <div className="flex justify-between">
              <span>Shipping (JNE {selectedRate.serviceName})</span>
              <span className="font-medium">{formatIDR(selectedRate.price)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium pt-1 border-t">
            <span>Order total</span>
            <span>{formatIDR((grandTotalCents / 100).toFixed(2))}</span>
          </div>

          {effectivePaymentType === "DP" ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 space-y-1">
              <p className="font-medium text-amber-900">This is a deposit (DP) order.</p>
              <div className="flex justify-between text-amber-900">
                <span>Merchandise deposit (50%)</span>
                <span>{formatIDR((depositCents / 100).toFixed(2))}</span>
              </div>
              {fulfilmentMethod === "SHIPPING" && selectedRate && (
                <div className="flex justify-between text-amber-900">
                  <span>Shipping (paid in full now)</span>
                  <span>{formatIDR(selectedRate.price)}</span>
                </div>
              )}
              <div className="flex justify-between text-amber-900 font-semibold pt-1 border-t border-amber-200">
                <span>Pay now</span>
                <span>{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
              </div>
              <div className="flex justify-between text-amber-800">
                <span>Remaining merchandise balance (due later, once ready)</span>
                <span>{formatIDR(((subtotalCents - depositCents) / 100).toFixed(2))}</span>
              </div>
              <p className="text-xs text-amber-700 pt-1">
                You'll be notified when the remaining balance is due — you don't need to pay it now.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5">
              <p className="font-medium text-blue-900">You're paying the full amount now.</p>
              <div className="flex justify-between text-blue-900 mt-1">
                <span>Amount to transfer</span>
                <span className="font-semibold">{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
              </div>
            </div>
          )}

          {paymentSettings ? (
            <div className="pt-2 mt-2 border-t space-y-1">
              <p className="text-muted-foreground">Transfer to:</p>
              <p>
                <span className="font-medium">{paymentSettings.bank_name}</span> —{" "}
                {paymentSettings.account_number}
              </p>
              <p className="text-muted-foreground">a.n. {paymentSettings.account_holder_name}</p>
            </div>
          ) : (
            <p className="text-muted-foreground pt-2 mt-2 border-t">
              Bank account details aren't configured yet — contact us before paying.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Payment proof <span className="text-destructive text-sm font-normal">*</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Upload a screenshot of your transfer receipt for the amount shown above.
          </p>
          <FileInput
            ref={proof.inputRef}
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            onChange={proof.handleFileChange}
            disabled={proof.uploading}
            hint="JPG, PNG or WebP"
          />
          {proof.uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
          {proof.path && proof.previewUrl && !proof.uploading && (
            <FileUploadPreview previewUrl={proof.previewUrl} label={proof.fileName ?? "Uploaded"} onRemove={proof.reset} />
          )}
          {proof.error && <p className="text-destructive text-sm">{proof.error}</p>}
        </CardContent>
      </Card>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}
    </>
  );
}
