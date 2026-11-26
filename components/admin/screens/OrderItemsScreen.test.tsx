import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderItemData, AdminOrderItemRow } from '@/lib/admin/order-items';
import { normalizeAdminOrderItemFilters } from '@/lib/admin/order-items';
import { OrderItemsScreen } from './OrderItemsScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/order-actions', () => ({ bulkConfirmAdminOrdersAction: vi.fn() }));

const ORDER_ID = '76b3ad83-aaaf-455f-a07e-7c7d0143da59';
const ITEM_ID = '1fe5f1e8-19a4-4f34-8cc6-4742e7d9fad3';
const SECOND_ITEM_ID = '2fe5f1e8-19a4-4f34-8cc6-4742e7d9fad4';

function row(overrides: Partial<AdminOrderItemRow> = {}): AdminOrderItemRow {
  return {
    id: ITEM_ID, orderId: ORDER_ID, userId: '378dae74-b218-4c2f-80ff-27af804b736b', buyerName: '합성 구매자', recipientName: '합성 수령인',
    status: 'paid', createdAt: '2026-09-01T14:59:59Z', goodId: 'good', goodName: '합성 상품', variantName: '선택 옵션', variantCode: 'ABC-001',
    customInputs: null, qty: 2, unitPrice: 1000, itemAmount: 2000, shipmentId: null, shipmentStatus: null, originName: null, trackingNumber: null,
    carrierLabel: null, claim: null, productOrderNumber: '2026090120000042', orderNumber: '2026090110000042', ...overrides,
  };
}

function data(rows: AdminOrderItemRow[]): AdminOrderItemData {
  return {
    filters: normalizeAdminOrderItemFilters({ view: 'items' }), rows, total: rows.length, orderCount: 1, qty: rows.reduce((sum, item) => sum + item.qty, 0),
    fingerprint: 'a'.repeat(32), counts: { pending: 0, paid: rows.length, confirmed: 0, shipping: 0, delivered: 0, done: 0, canceled: 0 },
  };
}

/* 상품주문별 조회(2026-11-26 화면 규칙 정리): 이름·정렬·결제수단을 주문별 조회와 맞추고, 메뉴설명을 줄이고, 같은 조건으로 체크칸을 뺀다. */
describe('OrderItemsScreen', () => {
  it('열·링크 이름은 주문별 조회와 같은 말을 쓴다(옵션 자동코드·구매자·수령인·주문 상세)', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />);
    for (const name of ['옵션 / 옵션 자동코드', '구매자', '수령인', '주문 상세']) expect(html).toContain(`>${name}</th>`);
    /* 조회 조건의 검색 대상 이름('구매자명')은 주문별 조회와 함께 쓰는 공용 이름이라 표 머리글만 본다. */
    for (const old of ['>옵션 / 옵션코드</th>', '>구매자명</th>', '>수령인명</th>', '>주문 전체 상세</th>', '전체 처리', '전체 상세']) expect(html).not.toContain(old);
    /* 끝 열의 링크는 주문 상세로 가고, 발주확인은 없다 — 이름이 가는 곳을 말한다. */
    expect(html).toMatch(/<a[^>]*href="\/admin\/sales\/orders\/76b3ad83-aaaf-455f-a07e-7c7d0143da59[^"]*"[^>]*>주문 상세<\/a>/);
  });

  it('정렬 이름은 주문별 조회와 같고, 금액만 상품금액이다', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />);
    for (const label of ['조회기준일 최신순', '조회기준일 오래된순', '상품금액 높은순', '상품금액 낮은순']) expect(html).toContain(`>${label}</option>`);
    expect(html).not.toContain('>최근순<');
    expect(html).not.toContain('>과거순<');
  });

  it('결제수단 조건은 카드·무통장으로 뭉뚱그리지 않고 사실대로 부른다', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />);
    expect(html).toContain('<option value="card">토스 결제(카드·가상계좌·계좌이체)</option>');
    expect(html).toContain('<option value="bank_transfer">무통장 입금(직접 이체)</option>');
    expect(html).not.toMatch(/>카드<\/option>|>무통장<\/option>/);
  });

  it('메뉴설명은 한 줄로 줄고, 부분 취소가 있을 때만 취소 수량을 설명한다. 취소·반품 처리 방식은 말하지 않는다', () => {
    const plain = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />);
    expect(plain).toContain('상품주문번호는 주문 안 상품 한 줄의 번호입니다. 같은 주문번호가 여러 줄에 나올 수 있고, 상품명·옵션은 주문 당시 기록 그대로입니다.');
    expect(plain).not.toContain('취소·반품은 주문 전체·전액으로 처리합니다');
    expect(plain).not.toContain('취소 수량은');
    const partial = renderToStaticMarkup(<OrderItemsScreen data={data([row({ partialCancel: { canceledQty: 1, activeQty: 1, activeItemAmount: 1000, paidAmount: 800 } })])} canManage />);
    expect(partial).toContain('취소 수량은 재고 부족 부분 취소로 뺀 수량입니다.');
  });

  it('할인·적립금 배분은 표 위 건수 줄 옆 "?"가 설명한다(열 머리글은 글자만 받는다)', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />);
    expect(html).toContain('aria-label="할인·적립금 배분 도움말"');
    expect(html).toMatch(/수량 2개 ·[^<]*<span[^>]*data-admin-help-label=""><span>할인·적립금 배분<\/span>/);
  });

  it('번호가 없는 옛 줄도 내부 번호(UUID 전체)를 보이지 않고 끝 8자로 부른다', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row({ productOrderNumber: undefined })])} canManage />);
    expect(html).not.toContain(`>${ITEM_ID}<`);
    expect(html).toContain('>4742E7D9FAD3<'.replace('4742E7D9FAD3', ITEM_ID.replaceAll('-', '').slice(-8).toUpperCase()));
    expect(html).toContain(`aria-label="상품주문 ${ITEM_ID.replaceAll('-', '').slice(-8).toUpperCase()} 선택"`);
    /* 번호가 있으면 그 번호다. */
    expect(renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage />)).toContain('aria-label="상품주문 2026090120000042 선택"');
  });

  /* I-01: 출고 보류 주문은 DB가 발주확인을 거절한다. 줄이 보류 여부(`fulfillmentHold`)를 실어 오면 주문별 조회처럼 체크칸을 뺀다. */
  it('출고 보류 주문의 줄에는 체크칸을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row(), row({ id: SECOND_ITEM_ID, productOrderNumber: '2026090120000043', fulfillmentHold: true })])} canManage />);
    expect(html).toContain('aria-label="상품주문 2026090120000042 선택"');
    expect(html).not.toContain('aria-label="상품주문 2026090120000043 선택"');
  });

  it('조회 전용 계정에는 체크칸과 일괄 발주확인이 없다', () => {
    const html = renderToStaticMarkup(<OrderItemsScreen data={data([row()])} canManage={false} />);
    expect(html).not.toContain('선택 주문 전체 발주확인');
    expect(html).not.toContain('type="checkbox"');
  });
});
