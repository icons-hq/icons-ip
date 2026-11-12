import { describe, expect, it } from 'vitest';
import { loadSettledExportNumbers } from '@/lib/admin/settled-workbook.server';
import { parseSmartStoreReplyText } from '@/lib/admin/smartstore-tracking-workbook.server';
import { parseTrackingImport } from '@/lib/admin/tracking-import';
import { trackingImportCommand } from '@/lib/admin/warehouse-templates.server';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';

/*
 * 1014-116·117: 주문 시각을 넣은 20자리 주문번호·상품주문번호가 들어와도 회신 파서가 번호를 알아보고,
 * 이미 발급한 16자리 번호로 들어오는 회신도 그대로 받는다. 파서는 형식 판정을 lib/commerce-number.ts에 맡긴다.
 */
const carriers: ShippingCarrierRegistry = [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}' },
];
const TIMED_ORDER = '20261112143510000042';
const LEGACY_ORDER = '2026102110000001';
const TIMED_ITEM = '20261112143520000057';
const LEGACY_ITEM = '2026102120000003';
const SHIPMENT = '2026111230000009';

describe('일반 운송장 입력(배송건번호·택배사·운송장 세 칸)', () => {
  it('배송건번호와 단일 배송 주문번호를 두 형식 모두 받는다', () => {
    const result = parseTrackingImport([
      '배송건번호,택배사코드,운송장번호',
      `${TIMED_ORDER},hanjin,111122223333`,
      `${LEGACY_ORDER},hanjin,444455556666`,
      `${SHIPMENT},hanjin,777788889999`,
    ].join('\n'), carriers);
    expect(result.issues).toEqual([]);
    expect(result.rows.map(row => row.reference)).toEqual([TIMED_ORDER, LEGACY_ORDER, SHIPMENT]);
  });

  it('상품주문번호와 시각이 틀린 번호는 세 칸 양식에서 거절한다', () => {
    const result = parseTrackingImport([`${TIMED_ITEM},hanjin,111122223333`, '20261112246010000042,hanjin,444455556666'].join('\n'), carriers);
    expect(result.rows).toEqual([]);
    expect(result.issues.map(issue => issue.line)).toEqual([1, 2]);
  });
});

describe('ICONS 표준 양식 회신(상품주문번호)', () => {
  const csv = (rows: string[][]) => [['운송장번호', '상품주문번호', '택배사'], ...rows].map(row => row.join(',')).join('\r\n');

  it('20자리·16자리 상품주문번호를 그대로 DB 회신 명령에 싣는다', () => {
    const parsed = parseSmartStoreReplyText(csv([['123456789012', TIMED_ITEM, '한진택배'], ['123456789013', LEGACY_ITEM, '한진택배']]), carriers)!;
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [
      { line: 2, reference: TIMED_ITEM, carrier: 'hanjin', trackingNumber: '123456789012' },
      { line: 3, reference: LEGACY_ITEM, carrier: 'hanjin', trackingNumber: '123456789013' },
    ] } });
  });

  it('주문번호를 상품주문번호 칸에 넣거나 Excel이 숫자로 바꾼 20자리는 거절한다', () => {
    const parsed = parseSmartStoreReplyText(csv([['123456789012', TIMED_ORDER, '한진택배'], ['123456789013', '2.02611E+19', '한진택배']]), carriers)!;
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues[0].reason).toContain('전체 상품주문번호');
    expect(parsed.issues[1].reason).toContain('숫자로 바뀌어');
  });
});

describe('거래확정 엑셀 표시 번호', () => {
  it('20자리 주문번호·주문 품목 번호와 16자리 배송 건 번호를 그대로 싣고, 형식이 틀린 값은 버린다', async () => {
    const rows = [{ id: 'order-1', order_number: TIMED_ORDER, order_items: [{ id: 'item-1', product_order_number: TIMED_ITEM }, { id: 'item-2', product_order_number: TIMED_ORDER }],
      order_shipments: [{ id: 'ship-1', shipment_number: SHIPMENT }, { id: 'ship-2', shipment_number: '20261112143530000009' }] },
    { id: 'order-2', order_number: LEGACY_ORDER, order_items: [{ id: 'item-3', product_order_number: LEGACY_ITEM }], order_shipments: [] }];
    const client = { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) };
    const numbers = await loadSettledExportNumbers(client as never, ['order-1', 'order-2']);
    expect([...numbers.orders]).toEqual([['order-1', TIMED_ORDER], ['order-2', LEGACY_ORDER]]);
    expect([...numbers.items]).toEqual([['item-1', TIMED_ITEM], ['item-3', LEGACY_ITEM]]);
    expect([...numbers.shipments]).toEqual([['ship-1', SHIPMENT]]);
  });
});
