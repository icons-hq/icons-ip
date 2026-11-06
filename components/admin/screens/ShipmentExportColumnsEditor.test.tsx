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
 it('바코드·ERP 코드·ERP 품명을 선택 열로 고를 수 있고 값의 원천을 설명한다', () => {
  const html=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={origin} canEdit />);
  for(const label of ['바코드 포함','ERP 코드 포함','ERP 품명 포함'])expect(html).toContain(label);
  /* 저장은 양식 제출(onSubmit)이다 — kit Button은 type이 없으면 button이 된다. */
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>출고지시 양식 저장</);
  expect(html).toContain('주문 당시 값이 비어 있으면 지금 등록된 값');
 });
 it('서원·김포 양식 설명에 덧붙인 열과 ERP 품명 사용을 적는다', () => {
  const seowon=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={{...origin,exportTemplate:'seowon_xlsx'}} canEdit />);
  for(const header of ['<li>옵션명</li>','<li>바코드</li>','<li>ERP 품명</li>'])expect(seowon).toContain(header);
  expect(seowon).toContain('받는분성명·배송메시지·배송건번호·옵션명·바코드·ERP 품명');
  const gimpo=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={{...origin,exportTemplate:'wms_csv'}} canEdit />);
  // 11/03 결정: ERP 품명이 있으면 상품명(확정)·옵션(확정)·두 조합 열이 모두 ERP 품명을 따른다.
  expect(gimpo).toContain('옵션에 ERP 품명이 있으면 상품명(확정)·옵션(확정)과 앞의 두 조합 열(상품명(확정)+옵션+수량)에 ERP 품명을 쓰고');
  expect(gimpo).toContain('옵션(수집)은 늘 주문 당시 옵션명입니다.');
 });
 it('shows a stored optional mapping with its custom header and keeps staff read-only', () => {
  const html=renderToStaticMarkup(<ShipmentExportColumnsEditor origin={{...origin,exportColumns:[...DEFAULT_SHIPMENT_EXPORT_COLUMNS,{key:'variantCode',header:'WMS SKU'}]}} canEdit={false} />);
  expect(html).toContain('checked=""');
  expect(html).toMatch(/<th[^>]*>옵션코드<\/th>/);
  expect(html).toContain('value="WMS SKU"');
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).not.toContain('출고지시 양식 저장');
 });
});
