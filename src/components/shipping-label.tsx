import { formatOrderNumber } from "@/lib/utils";

export interface ShippingLabelSender {
  name: string;
  phone: string;
  city: string;
  address: string;
}

export interface ShippingLabelOrder {
  id: string;
  orderNumber: number | null;
  fulfilmentMethod: string | null;
  shipment: {
    recipientName: string;
    recipientPhone: string;
    address: string;
    destinationDistrictName: string;
    courier: string;
    service: string | null;
    trackingNumber: string | null;
  };
}

interface ShippingLabelProps {
  sender: ShippingLabelSender;
  order: ShippingLabelOrder;
}

export function ShippingLabel({ sender, order }: ShippingLabelProps) {
  const shipment = order.shipment;

  return (
    <div className="shipping-label">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">{formatOrderNumber(order.fulfilmentMethod, order.orderNumber, order.id)}</span>
        <span>
          {shipment.courier}
          {shipment.service ? ` — ${shipment.service}` : ""}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">From</p>
        <p className="font-semibold">{sender.name}</p>
        <p>
          {sender.address}, {sender.city}
        </p>
        <p>{sender.phone}</p>
      </div>

      <div className="mt-4 pt-3 border-t-2 border-dashed border-black">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">To</p>
        <p className="font-semibold text-lg">{shipment.recipientName}</p>
        <p>
          {shipment.address}, {shipment.destinationDistrictName}
        </p>
        <p>{shipment.recipientPhone}</p>
      </div>

      {shipment.trackingNumber && <p className="mt-3 font-mono text-xs">Tracking: {shipment.trackingNumber}</p>}
    </div>
  );
}
