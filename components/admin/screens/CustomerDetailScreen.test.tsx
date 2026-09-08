import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCustomerDetail } from '@/lib/admin/customer-detail';
import { CustomerDetailScreen } from './CustomerDetailScreen';
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useActionState: (_a: unknown, state: unknown) => [state, vi.fn(), false] }));
vi.mock('@/app/admin/customer-actions', () => ({ addCustomerNoteAction: vi.fn(), loadCustomerHistoryAction: vi.fn() }));
vi.mock('@/app/admin/member-actions', () => ({ suspendAdminMemberAction: vi.fn(), unsuspendAdminMemberAction: vi.fn(), adjustMemberLoyaltyAction: vi.fn(), recalculateMemberLoyaltyAction: vi.fn() }));
const USER = '00000000-0000-4000-8000-000000004301';
const detail: AdminCustomerDetail = {
  customer: { id: USER, nickname: '상담 고객', email: 'customer@example.test', role: 'user', createdAt: '2026-01-01T00:00:00Z',
    consents: { terms: true, privacy: true, marketing: false }, suspendedAt: null, suspensionReason: null,
    loyaltyGrade: 'silver', goodsOrderCount: 25, ticketOrderCount: 2, submittedReportCount: 0, receivedReportCount: 0 },
  counts: { orders: 25, inquiries: 3, claims: 2, coupons: 4, notes: 1 }, tab: 'overview', page: 1, pageSize: 20, total: 0, items: [],
};
const render = (data = detail) => renderToStaticMarkup(<CustomerDetailScreen detail={data} actor={{ id: 'actor', role: 'staff' }} noteOperationId="operation" />);
describe('고객 상세 작업 공간', () => {
  it('정확한 고객 탭과 전체 정보, 등급·동의·정지 컨트롤을 제공한다', () => {
    const html = render();
    for (const value of ['customer@example.test', 'SILVER', '개인정보', '미동의', '계정 정지', '내부 메모', '취소·반품·교환 관리']) expect(html).toContain(value);
    expect(html).toContain(`/admin/customers/${USER}?tab=orders`);
  });
  it('주문 탭은 지정 주문 상세와 고객 안의 다음 페이지로 이어진다', () => {
    const html = render({ ...detail, tab: 'orders', total: 25, items: [{ id: 'order-1', title: '주문 당시 상품', status: 'paid', amount: 12800, createdAt: '2026-09-01T00:00:00Z' }] });
    expect(html).toContain('/admin/sales/orders/order-1');
    expect(html).toContain(`/admin/customers/${USER}?tab=orders&amp;page=2`);
    expect(html).toContain('12,800원');
  });
  it('메모는 작성자와 함께 별도 탭에 나타나고 staff 계정 제재 권한은 확장하지 않는다', () => {
    const html = render({ ...detail, tab: 'notes', total: 1, items: [{ id: 'note-1', createdAt: '2026-09-01T00:00:00Z', authorName: '수민', body: '내부 상담 메모' }] });
    expect(html).toContain('수민'); expect(html).toContain('내부 상담 메모'); expect(html).toContain('고객에게 전달되지 않습니다');
    expect(render({ ...detail, customer: { ...detail.customer, role: 'staff' } })).not.toContain('>계정 정지</button>');
  });
});
