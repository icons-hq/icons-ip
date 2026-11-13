import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InquiryPurchaseHistory } from '@/lib/admin/inquiry-purchase-history';
import { InquiryPurchaseHistoryPanel } from './InquiryPurchaseHistoryPanel';

vi.mock('@/app/admin/inquiry-purchase-history-actions', () => ({ loadInquiryPurchaseHistoryAction: vi.fn() }));

const INQUIRY = 'a1030000-0000-4000-8000-000000000401';
const history: InquiryPurchaseHistory = { inquiryId: INQUIRY, customerId: 'a1030000-0000-4000-8000-000000000001', page: 1, pageSize: 20, total: 2,
  linkedOrder: { id: 'a1030000-0000-4000-8000-000000000101', orderNumber: '20260901000010000001', status: 'delivered', amount: 1000, createdAt: '2026-09-01T01:00:00Z', title: '합성 키링', quantity: 3 },
  items: [
    { id: 'a1030000-0000-4000-8000-000000000102', orderNumber: '20260901010010000002', status: 'canceled', amount: 2000, createdAt: '2026-09-01T02:00:00Z', title: '합성 스티커', itemCount: 2 },
    { id: 'a1030000-0000-4000-8000-000000000101', orderNumber: '20260901000010000001', status: 'delivered', amount: 1000, createdAt: '2026-09-01T01:00:00Z', title: '합성 키링', itemCount: 1 },
  ] };
const render = (props: Partial<Parameters<typeof InquiryPurchaseHistoryPanel>[0]> = {}) =>
  renderToStaticMarkup(<InquiryPurchaseHistoryPanel inquiryId={INQUIRY} canOpenOrders={false} {...props} />);

describe('상담 중 고객 구매이력 패널(1014-103)', () => {
  it('미리 읽은 이력은 금액·상태·주문번호와 함께 버튼 없이 보이고, 주문 조회 권한이 없으면 주문 화면 링크가 없다', () => {
    const html = render({ initialHistory: history });
    for (const text of ['합성 스티커', '2,000원 · 2개 품목', '취소', '배송완료', '주문번호 20260901010010000002']) expect(html).toContain(text);
    expect(html).not.toContain('구매이력 불러오기'); expect(html).not.toContain('/admin/sales/orders/');
    expect(html).not.toContain('연결 주문');
  });
  it('주문 조회 권한이 있으면 주문 상세 링크를 둔다', () => {
    expect(render({ initialHistory: history, canOpenOrders: true })).toContain('href="/admin/sales/orders/a1030000-0000-4000-8000-000000000102"');
  });
  it('연결 주문 카드가 없는 화면은 그 문의의 연결 주문 요약을 목록 위에 보인다', () => {
    const html = render({ initialHistory: history, showLinkedOrder: true });
    expect(html).toContain('연결 주문 20260901000010000001'); expect(html).toContain('합성 키링 · 3개 · 1,000원');
    expect(render({ initialHistory: { ...history, linkedOrder: null }, showLinkedOrder: true })).toContain('연결된 주문이 없습니다.');
  });
  it('미리 읽은 이력이 없거나 다른 문의의 이력이면 열람 기록 안내와 함께 불러오기 버튼을 둔다', () => {
    for (const html of [render(), render({ initialHistory: { ...history, inquiryId: 'a1030000-0000-4000-8000-000000000402' } })]) {
      expect(html).toContain('구매이력 불러오기'); expect(html).toContain('열람은 기록에 남습니다.');
      expect(html).toContain(`name="inquiryId" value="${INQUIRY}"`); expect(html).not.toContain('합성 스티커');
    }
    expect(render({ initialHistory: { ...history, items: [], total: 0, linkedOrder: null } })).toContain('주문 이력이 없습니다.');
  });
});
