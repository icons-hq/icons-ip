import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentExportColumnsEditor } from './ShipmentExportColumnsEditor';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from '@/lib/admin/shipment-workbook';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-actions', () => ({ saveShipmentExportColumnsAction: vi.fn() }));
const origin: FulfillmentOrigin = { id:'00000000-0000-4000-8000-000000042201',code:'gimpo',name:'김포',defaultCarrier:'hanjin',baseFee:3000,freeThreshold:null,returnAddress:'주소',cutoff:null,exportTemplate:'standard',active:true,updatedAt:'2026-09-08T00:00:00Z' };
describe('shipment export optional warehouse SKU', () => {
 it('offers an optional SKU while leaving default columns unchanged', () => {
  const html=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={origin} canEdit />);
  expect(html).toContain('옵션코드 포함');
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('checked=""');
  expect(html).toContain('주문 당시');
 });
 it('shows a stored optional mapping with its custom header and keeps staff read-only', () => {
  const html=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={{...origin,exportColumns:[...DEFAULT_SHIPMENT_EXPORT_COLUMNS,{key:'variantCode',header:'WMS SKU'}]}} canEdit={false} />);
  expect(html).toContain('checked=""');
  expect(html).toContain('<th>옵션코드</th>');
  expect(html).toContain('value="WMS SKU"');
  expect(html).toContain('<fieldset disabled=""');
  expect(html).not.toContain('출고지시 양식 저장');
 });
});
