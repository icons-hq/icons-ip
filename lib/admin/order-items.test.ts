import { describe, expect, it } from 'vitest';
import { adminOrderItemsHref, normalizeAdminOrderItemFilters, orderViewHref, parseAdminOrderItemData, selectedConfirmableOrderIds } from './order-items';
import { orderItemsExportSheet } from './order-items-export';
import { adminOrderBackHref, adminOrderDetailHrefFromBack } from './orders';

const filters = normalizeAdminOrderItemFilters({ view: 'items', field: 'item', query: '품목', page: '3', status: 'paid', pageSize: '100' });
const row = { id: '1fe5f1e8-19a4-ef34-ccc6-4742e7d9fad3', orderId: '76b3ad83-aaaf-855f-d07e-7c7d0143da59', userId: '378dae74-b218-5c2f-80ff-27af804b736b',
  buyerName: '합성 구매자', recipientName: '합성 수취인', status: 'paid', createdAt: '2026-09-01T14:59:59Z', goodId: 'good', goodName: '주문 당시 이름',
  variantName: '선택 옵션', variantCode: 'CODE', customInputs: null, qty: 2, unitPrice: 1000, itemAmount: 2000, shipmentId: null,
  shipmentStatus: null, originName: null, trackingNumber: null, carrierLabel: null, claim: null };
const payload = { rows: [row], total: 1, orderCount: 1, qty: 2, fingerprint: 'a'.repeat(32), counts: { pending: 0, paid: 1, confirmed: 0, shipping: 0, delivered: 0, done: 0, canceled: 0 } };
describe('상품주문별 조회 계약', () => {
  it('품목 검색·목록 설정·페이지를 URL에 보존하고 주문 보기로 이동할 때 품목 검색을 비운다', () => {
    expect(filters).toMatchObject({ field: 'item', query: '품목', page: 3, pageSize: 100, orderId: null });
    const href = new URL(adminOrderItemsHref(filters), 'https://example.test');
    expect(href.searchParams.get('view')).toBe('items'); expect(href.searchParams.get('field')).toBe('item'); expect(href.searchParams.get('page')).toBe('3');
    const orderHref = new URL(orderViewHref(filters, 'orders'), 'https://example.test');
    expect(orderHref.searchParams.has('view')).toBe(false); expect(orderHref.searchParams.has('query')).toBe(false); expect(orderHref.searchParams.get('page')).toBe('1');
    expect(new URL(orderViewHref(filters, 'items'), 'https://example.test').searchParams.get('page')).toBe('1');
  });
  it('Postgres의 UUID 버전과 무관하게 품목·주문 번호를 읽고 중복 품목·금액 불일치는 거절한다', () => {
    expect(parseAdminOrderItemData(payload, filters)?.rows[0]).toMatchObject({ id: row.id, itemAmount: 2000 });
    expect(parseAdminOrderItemData({ ...payload, total: 2, rows: [row, row] }, filters)).toBeNull();
    expect(parseAdminOrderItemData({ ...payload, rows: [{ ...row, itemAmount: 1999 }] }, filters)).toBeNull();
    expect(parseAdminOrderItemData({ ...payload, rows: [{ ...row, shipmentStatus: 'invented' }] }, filters)).toBeNull();
  });
  it('재고 부족 부분 취소가 있는 품목은 취소 수량·남은 금액을 싣고, 엑셀은 그때만 취소 수량 열을 두고 남은 몫을 쓴다', () => {
    const canceled = { ...row, canceledQty: 1, activeQty: 1, activeItemAmount: 1000, partialCanceledPaidAmount: 800 };
    const parsed = parseAdminOrderItemData({ ...payload, rows: [canceled] }, filters)!;
    expect(parsed.rows[0]).toMatchObject({ qty: 2, itemAmount: 2000, partialCancel: { canceledQty: 1, activeQty: 1, activeItemAmount: 1000, paidAmount: 800 } });
    expect(parsed.rows[0]).not.toHaveProperty('canceledQty');
    expect(parseAdminOrderItemData({ ...payload, rows: [{ ...canceled, activeQty: 2 }] }, filters)).toBeNull();
    expect(parseAdminOrderItemData({ ...payload, rows: [{ ...canceled, activeItemAmount: 999 }] }, filters)).toBeNull();
    expect(parseAdminOrderItemData({ ...payload, rows: [{ ...row, activeQty: 1 }] }, filters)).toBeNull();
    const sheet = orderItemsExportSheet([{ ...parsed.rows[0], allocation: { source: 'recorded', volumeDiscount: 0, couponDiscount: 300, storeCreditDiscount: 100, paidGoodsTotal: 1600 } }], filters, parsed.fingerprint);
    const at = (header: string) => sheet.rows[0][sheet.columns.findIndex(entry => entry.header === header)];
    expect([at('수량'), at('취소 수량'), at('상품 금액'), at('품목 실결제액(배송비 제외)')]).toEqual([1, 1, 1000, 800]);
    expect(sheet.notes.join(' ')).toContain('재고 부족 부분 취소');
    const plain = orderItemsExportSheet(parseAdminOrderItemData(payload, filters)!.rows, filters, parsed.fingerprint);
    expect(plain.columns.some(entry => entry.header === '취소 수량')).toBe(false);
  });
  it('범위를 벗어난 페이지에서도 전체 건수·중복 제외 주문 수를 보존한다', () => {
    expect(parseAdminOrderItemData({ ...payload, rows: [] }, filters)).toMatchObject({ total: 1, orderCount: 1, qty: 2 });
    expect(parseAdminOrderItemData({ ...payload, orderCount: 2 }, filters)).toBeNull();
    expect(parseAdminOrderItemData({ ...payload, fingerprint: 'invalid' }, filters)).toBeNull();
  });
  it('엑셀은 품목 금액을 기록하고 같은 주문의 금액을 중복 합산하지 않는다', () => {
    const data = parseAdminOrderItemData(payload, filters)!;
    const sheet = orderItemsExportSheet(data.rows, filters, data.fingerprint);
    expect(sheet.recordCount).toBe(1);
    expect(sheet.rows[0][0]).toBe(row.id); expect(sheet.rows[0][1]).toBe(row.orderId);
    expect(sheet.rows[0][sheet.columns.findIndex(column => column.header === '상품 금액')]).toBe(2000);
    expect(sheet.notes.join(' ')).toContain('주문 전체');
    expect(sheet.filters).toMatchObject({ view: 'items', fingerprint: data.fingerprint });
    const column = (header: string) => sheet.columns.findIndex(entry => entry.header === header);
    expect(sheet.rows[0][column('품목 실결제액(배송비 제외)')]).toBeNull();
    const allocated = orderItemsExportSheet([{ ...data.rows[0], allocation: { source: 'legacy', volumeDiscount: 0, couponDiscount: 300, storeCreditDiscount: 100, paidGoodsTotal: 1600 } }], filters, data.fingerprint);
    expect([column('쿠폰 할인(품목)'), column('적립금 사용(품목)'), column('품목 실결제액(배송비 제외)')].map(index => allocated.rows[0][index])).toEqual([300, 100, 1600]);
    expect(sheet.notes.join(' ')).toContain('거래확정 엑셀과 같은 규칙');
    const shown = orderItemsExportSheet([{ ...data.rows[0], buyerName: '이름 미등록', shipmentStatus: 'delivered' }, { ...data.rows[0], shipmentStatus: 'ready' }, { ...data.rows[0], shipmentStatus: 'shipping' }, { ...data.rows[0], shipmentStatus: 'canceled' }], filters, data.fingerprint);
    expect(shown.rows[0][column('구매자')]).toBe('fan_378dae'); expect(shown.rows[1][column('구매자')]).toBe('합성 구매자');
    expect(shown.rows.map(values => values[column('배송 상태')])).toEqual(['배송 완료', '배송 준비', '배송 중', '취소']);
    expect(sheet.columns.map(entry => entry.header)).toEqual(['상품주문번호', '주문번호', '주문 상태', '주문일시', '상품 URL', '상품명', '옵션', '옵션코드', '직접 입력 옵션', '수량', '판매가', '상품 금액', '복수구매 할인(품목)', '쿠폰 할인(품목)', '적립금 사용(품목)', '품목 실결제액(배송비 제외)', '구매자', '수취인', '출고지', '배송 상태', '택배사', '운송장번호', '취소·반품·교환 요청']);
    expect(Object.fromEntries(sheet.conditions)).toMatchObject({ '검색 대상': '상품주문번호', 주문일: '전체 기간', 정렬: '조회기준일 최신순', 결제수단: '전체', '주문 상태': '신규주문' });
  });
});


it('선택한 품목을 주문 전체로 중복 제거하고 미입금·진행 중 클레임은 처리 대상에서 제외한다', () => {
  const base = parseAdminOrderItemData(payload, filters)!.rows[0];
  const rows = [base, { ...base, id: 'same-order-other-item' }, { ...base, id: 'pending-item', orderId: 'other-order', status: 'pending' as const },
    { ...base, id: 'claim-item', orderId: 'claim-order', claim: { id: 'claim', type: 'cancel' as const, stage: 'requested' as const } }];
  expect(selectedConfirmableOrderIds(rows, rows.map(item => item.id))).toEqual([base.orderId]);
  expect(selectedConfirmableOrderIds(rows, ['unknown-item'])).toEqual([]);
});


it('상세의 돌아가기 링크가 품목 보기·검색·페이지를 복원하고 외부 경로는 거절한다', () => {
  const back = adminOrderItemsHref(filters);
  expect(adminOrderBackHref(back)).toBe(back);
  const detail = new URL(adminOrderDetailHrefFromBack(row.orderId, back), 'https://example.test');
  expect(adminOrderBackHref(detail.searchParams.get('back'))).toBe(back);
  expect(adminOrderBackHref('https://outside.example/admin/sales/orders?view=items')).toBe('/admin/sales/orders');
});
