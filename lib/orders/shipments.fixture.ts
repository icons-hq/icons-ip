import type { ShipmentRecord } from './shipments';
/** Shared receipt fixtures keep every tested surface on the complete shipment contract. */
export function shipmentFixture(overrides: Partial<ShipmentRecord> = {}): ShipmentRecord {
  return { id:'00000000-0000-4000-8000-000000044701',orderId:'11111111-1111-4111-8111-111111111111',originId:'00000000-0000-4000-8000-000000042201',originName:'김포',shippingFee:3000,status:'shipping',carrier:'hanjin',carrierLabel:'한진택배',trackingNumber:'123456789012',trackingUrl:'https://carrier.example.test/track?no=123456789012',shippedAt:'2026-09-08T00:00:00Z',deliveredAt:null,exportedAt:null,orderItemIds:['item-1'],...overrides };
}
