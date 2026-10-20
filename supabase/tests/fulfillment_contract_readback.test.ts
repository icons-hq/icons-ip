import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseCheckoutTransactionReceipt } from '@/lib/checkout-transaction';
import { parseOrderDownloads } from '@/lib/order-downloads';
import { shipmentRecord, type ShipmentRow } from '@/lib/orders/shipments';
const path = process.env.ICONS_FULFILLMENT_READBACK;
it.skipIf(!path)('actual isolated DB contracts cross the customer and admin parsers', () => {
 const rows = JSON.parse(readFileSync(path!, 'utf8')) as { receipt: unknown; downloads: unknown; shipments: ShipmentRow[] }[];
 expect(rows.length).toBeGreaterThan(1);
 for (const row of rows) {
  expect(parseCheckoutTransactionReceipt(row.receipt)).not.toBeNull(); expect(parseOrderDownloads(row.downloads)).not.toBeNull();
  for (const shipment of row.shipments) expect(() => shipmentRecord(shipment, [])).not.toThrow();
 }
});
