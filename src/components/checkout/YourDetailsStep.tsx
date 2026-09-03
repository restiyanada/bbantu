import { z } from "zod";
import type { UseFormRegister, FieldErrors } from "react-hook-form";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ShippingSelection } from "@/lib/useShippingSelection";

export const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
export const PHONE_PATTERN = /^[0-9]{8,15}$/;

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
  email: z.string().trim().email("A valid email is required."),
});

export type CustomerValues = z.infer<typeof customerSchema>;

export function YourDetailsStep(props: {
  register: UseFormRegister<CustomerValues>;
  errors: FieldErrors<CustomerValues>;
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  onFulfilmentMethodChange: (method: "PICKUP" | "SHIPPING") => void;
  shippingAllowed: boolean;
  shipping: ShippingSelection;
  cartItems: { variantId: string; quantity: number }[];
  detailsError: string | null;
  watch: (name: "name" | "phone") => string | undefined;
}) {
  const { register, errors, fulfilmentMethod, onFulfilmentMethodChange, shippingAllowed, shipping, cartItems, detailsError, watch } =
    props;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Name
              <RequiredMark />
            </Label>
            <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
            {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">
              Phone number
              <RequiredMark />
            </Label>
            <Input id="phone" aria-invalid={!!errors.phone} {...register("phone")} />
            {errors.phone && <p className="text-destructive text-xs">{errors.phone.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">
              Email
              <RequiredMark />
            </Label>
            <Input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} />
            {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
          </div>
        </CardContent>
      </Card>

      {shippingAllowed && (
        <Card>
          <CardHeader>
            <CardTitle>Fulfilment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={fulfilmentMethod === "PICKUP"}
                  onChange={() => onFulfilmentMethodChange("PICKUP")}
                  className="accent-primary"
                />
                Booth pickup
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={fulfilmentMethod === "SHIPPING"}
                  onChange={() => onFulfilmentMethodChange("SHIPPING")}
                  className="accent-primary"
                />
                Shipping (JNE)
              </label>
            </div>

            {fulfilmentMethod === "SHIPPING" && (
              <div className="space-y-3 pt-3 border-t">
                {shipping.locationError && <p className="text-destructive text-xs">{shipping.locationError}</p>}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Province
                      <RequiredMark />
                    </Label>
                    <Select
                      value={shipping.selectedProvinceCode}
                      onChange={(e) => void shipping.handleProvinceChange(e.target.value)}
                      className="h-8 text-sm"
                    >
                      <option value="">
                        {shipping.provinces === null ? "Loading…" : "Select province"}
                      </option>
                      {shipping.provinces?.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      City / Regency
                      <RequiredMark />
                    </Label>
                    <Select
                      value={shipping.selectedCityCode}
                      onChange={(e) => void shipping.handleCityChange(e.target.value)}
                      disabled={!shipping.selectedProvinceCode}
                      className="h-8 text-sm"
                    >
                      <option value="">{shipping.cities === null ? "—" : "Select city"}</option>
                      {shipping.cities?.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      District
                      <RequiredMark />
                    </Label>
                    <Select
                      value={shipping.selectedDistrict?.code ?? ""}
                      onChange={(e) => shipping.handleDistrictChange(e.target.value)}
                      disabled={!shipping.selectedCityCode}
                      className="h-8 text-sm"
                    >
                      <option value="">{shipping.districts === null ? "—" : "Select district"}</option>
                      {shipping.districts?.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Street address, RT/RW, landmark, etc.
                    <RequiredMark />
                  </Label>
                  <Textarea
                    value={shipping.addressDetail}
                    onChange={(e) => shipping.setAddressDetail(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Shipping to <span className="font-medium text-foreground">{watch("name") || "—"}</span> ·{" "}
                  {watch("phone") || "—"}
                </p>

                <Button
                  type="button"
                  variant="info"
                  size="sm"
                  disabled={!shipping.selectedDistrict || shipping.rateLoading}
                  onClick={() => void shipping.handleGetRate(cartItems)}
                >
                  {shipping.rateLoading ? "Getting rate…" : "Get shipping rate"}
                </Button>
                {shipping.rateError && <p className="text-destructive text-xs">{shipping.rateError}</p>}

                {shipping.rates && shipping.rates.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {shipping.rates.map((rate) => (
                      <label
                        key={rate.serviceCode}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                          shipping.selectedServiceCode === rate.serviceCode
                            ? "border-primary bg-accent"
                            : "hover:bg-muted"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={shipping.selectedServiceCode === rate.serviceCode}
                            onChange={() => shipping.setSelectedServiceCode(rate.serviceCode)}
                            className="accent-primary"
                          />
                          JNE {rate.serviceName}
                          {rate.etd && <span className="text-muted-foreground"> · {rate.etd} days</span>}
                        </span>
                        <span className="font-medium">{formatIDR(rate.price)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {detailsError && <p className="text-destructive text-sm">{detailsError}</p>}
    </>
  );
}
