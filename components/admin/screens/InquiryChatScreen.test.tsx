import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeInquiryChatFilters, type InquiryChatData } from '@/lib/admin/inquiry-chat';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { InquiryChatScreen } from './InquiryChatScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/admin/useInquiryDraft', () => ({ useInquiryDraft: () => ({ body: '', ready: true, blocked: false, recovery: null, change: vi.fn() }) }));
const ID = 'a20c0000-0000-4000-8000-000000000201';
const ACCOUNT = 'a20c0000-0000-4000-8000-000000000002';
const data: InquiryChatData = { rows: [{ id: ID, reference: 1, title: '합성 배송 문의', category: 'order', status: 'open', buyerName: '합성 고객',
  assigneeId: null, assigneeName: null, lastMessageAt: '2026-10-20T01:00:00Z', preview: '배송이 언제 시작되나요?', previewAuthor: 'user', unreadCount: 2 }],
  total: 1, counts: { all: 1, open: 1, answered: 0, closed: 0 }, unreadMessages: 2, staffOptions: [] };
const detail: AdminInquiryDetail = { inquiry: { ...data.rows[0], buyerEmail: null, orderId: null, goodId: null, goodName: null, handlerName: null,
  waitingSince: '2026-10-20T01:00:00Z', createdAt: '2026-10-20T01:00:00Z', answeredAt: null, messageCount: 1, closedAt: null, userId: 'a20c0000-0000-4000-8000-000000000001' },
  messages: [{ id: 'a20c0000-0000-4000-8000-000000000301', author: 'user', authorName: null, body: '합성 고객 메시지', imageUrls: [], createdAt: '2026-10-20T01:00:00Z' }],
  order: null, buyer: { id: 'a20c0000-0000-4000-8000-000000000001', nickname: '합성 고객', email: null, suspendedAt: null, orderCount: 0, inquiryCount: 1, openInquiryCount: 1 }, staffOptions: [], notes: [] };
function render(props: Partial<Parameters<typeof InquiryChatScreen>[0]> = {}) {
  return renderToStaticMarkup(<InquiryChatScreen accountId={ACCOUNT} filters={normalizeInquiryChatFilters({})} data={data} detail={null} selected={false} canReadOrders={false} canViewCustomer={false} {...props} />);
}
describe('ICONS 상담 콘솔', () => {
  it('검색·상태·담당자·기간·읽음·정렬과 실제 안읽음 집계를 표시한다', () => {
    const html = render();
    expect(html).toContain('대화내용, 닉네임, 태그 검색'); expect(html).toContain('안읽은 메시지 2개 전체 보기');
    for (const label of ['담당자', '대화 기간', '읽음 여부', '대화 정렬']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('상담할 대화를 선택해 주세요'); expect(html).not.toContain('name="body"');
  });
  it('선택한 대화·답변·사진·자주 쓰는 문구·내부 메모를 같은 화면에서 제공한다', () => {
    const html = render({ detail, selected: true });
    for (const label of ['합성 고객 메시지', '상담완료', '사진 첨부', '자주 쓰는 문구', '내부 메모', '담당자 관리']) expect(html).toContain(label);
    expect(html).toContain(`name="inquiryId" value="${ID}"`); expect(html).not.toContain('구매이력'); expect(html).not.toContain('고객 상세 보기');
    expect(html).not.toContain('네이버'); expect(html).not.toContain('<iframe');
  });
  it('종결된 대화에는 전송 폼을 만들지 않는다', () => {
    const html = render({ detail: { ...detail, inquiry: { ...detail.inquiry, status: 'closed' } }, selected: true });
    expect(html).toContain('상담이 완료되었습니다.'); expect(html).not.toContain('class="admin-inquiry-chat__composer"');
  });
  it('정상 빈 목록과 존재하지 않는 선택 대화를 구분한다', () => {
    const html = render({ selected: true });
    expect(html).toContain('대화를 찾을 수 없습니다.'); expect(html).not.toContain('상담할 대화를 선택해 주세요');
  });
  it('주문 조회 권한이 있으면 구매이력을 버튼 없이 바로 보여 주고, 없으면 카드를 만들지 않는다', () => {
    const userId = detail.buyer.id;
    const purchaseHistory = { userId, tab: 'orders' as const, page: 1, pageSize: 20, total: 1,
      items: [{ id: 'a20c0000-0000-4000-8000-000000000401', title: '합성 키링', status: 'paid', amount: 12000, createdAt: '2026-10-19T01:00:00Z', itemCount: 1 }] };
    const html = render({ detail, selected: true, canReadOrders: true, purchaseHistory });
    expect(html).toContain('전체 구매이력'); expect(html).toContain('합성 키링'); expect(html).toContain('1 / 1 · 1건');
    expect(html).not.toContain('전체 구매이력 보기'); expect(html).not.toMatch(/<button(?=[^>]*name="tab")/);
    const other = render({ detail, selected: true, canReadOrders: true, purchaseHistory: { ...purchaseHistory, userId: 'a20c0000-0000-4000-8000-000000000009' } });
    expect(other).not.toContain('합성 키링'); expect(other).toMatch(/<button(?=[^>]*name="tab")(?=[^>]*value="orders")/);
    expect(render({ detail, selected: true, canReadOrders: true, purchaseHistoryError: true })).toContain('구매이력을 자동으로 불러오지 못했습니다');
    expect(render({ detail, selected: true, canReadOrders: false, purchaseHistory })).not.toContain('합성 키링');
  });
});
