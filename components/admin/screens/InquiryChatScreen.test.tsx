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
    expect(html).toContain(`name="inquiryId" value="${ID}"`); expect(html).not.toContain('고객 상세 보기');
    /* 구매이력 카드는 주문 조회 권한과 무관하게 상담 화면에 있다(1014-103). 미리 읽은 이력이 없으면 다시 불러오는 버튼이 보인다. */
    expect(html).toContain('구매이력'); expect(html).toContain('구매이력 불러오기');
    /* Enter 전송과 같은 폼을 버튼으로도 제출한다(kit Button은 type을 주지 않으면 button이 된다). */
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>(?:<svg[\s\S]*?<\/svg>)?전송<\/button>/);
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*aria-label="대화 검색하기"|<button(?=[^>]*aria-label="대화 검색하기")(?=[^>]*type="submit")/);
    expect(html).not.toContain('네이버'); expect(html).not.toContain('<iframe');
  });
  it('종결된 대화에는 전송 폼을 만들지 않는다', () => {
    const html = render({ detail: { ...detail, inquiry: { ...detail.inquiry, status: 'closed' } }, selected: true });
    expect(html).toContain('상담이 완료되었습니다.'); expect(html).not.toContain('data-chat-composer');
    expect(render({ detail, selected: true })).toContain('data-chat-composer');
  });
  /* 대화 목록 페이지 이동은 공용 ConsolePagination(링크 모드)이다 — 조회 조건을 유지한 채 page만 바꾼다. */
  it('대화 목록 페이지 이동은 범위 요약과 조건을 유지한 이전·다음 링크를 둔다', () => {
    const html = render({ data: { ...data, total: 61 }, filters: normalizeInquiryChatFilters({ status: 'open', page: '2' }) });
    expect(html).toMatch(/<nav aria-label="대화 목록 페이지"[^>]*><span[^>]*>31–60 \/ 전체 61건 · 2 \/ 3 페이지<\/span>/);
    expect(html).toMatch(/<a aria-label="이전 페이지"[^>]*href="\/admin\/cs\/chat\?status=open"/);
    expect(html).toMatch(/<a aria-label="다음 페이지"[^>]*href="\/admin\/cs\/chat\?status=open&amp;page=3"/);
  });
  /* 처리할 숫자(대기)만 주의색이다 — 안읽음 표시는 회색으로 물러나 대기와 섞이지 않고, 진행중은 진행 색이다. */
  it('대기 건수만 강조하고 빈 화면에서 대기 상담으로 안내한다', () => {
    const html = render({ data: { ...data, rows: [{ ...data.rows[0], status: 'answered', unreadCount: 2 }], counts: { all: 3, open: 2, answered: 1, closed: 0 } } });
    expect(html).toMatch(/text-warning[^>]*>2<\/strong>/);
    expect(html).toMatch(/data-tone="info"[^>]*>진행중</);
    expect(html).toMatch(/<a(?=[^>]*href="\/admin\/cs\/chat\?status=open")[^>]*>대기 상담 2건 보기<\/a>/);
    expect(html).not.toMatch(/border-warning-border[^>]*aria-label="안읽은 메시지/);
    expect(render({ filters: normalizeInquiryChatFilters({ status: 'open' }) })).not.toContain('대기 상담 1건 보기');
  });
  it('정상 빈 목록과 존재하지 않는 선택 대화를 구분한다', () => {
    const html = render({ selected: true });
    expect(html).toContain('대화를 찾을 수 없습니다.'); expect(html).not.toContain('상담할 대화를 선택해 주세요');
  });
  /* 1014-103(사용자 결정 "전부 다 아무나 볼 수 있게"): 상담 화면을 여는 모든 역할이 그 문의 고객의 구매이력(금액·상태)을 버튼 없이 본다.
     주문 상세로 가는 링크만 주문 조회 권한이 있을 때 둔다. */
  const purchaseHistory = { inquiryId: ID, customerId: detail.buyer.id, page: 1, pageSize: 20, total: 1,
    linkedOrder: { id: 'a20c0000-0000-4000-8000-000000000402', orderNumber: '20261019120010000001', status: 'delivered', amount: 15000, createdAt: '2026-10-19T03:00:00Z', title: '합성 연결 상품', quantity: 2 },
    items: [{ id: 'a20c0000-0000-4000-8000-000000000401', orderNumber: '20261019100010000002', title: '합성 키링', status: 'paid', amount: 12000, createdAt: '2026-10-19T01:00:00Z', itemCount: 1 }] };
  it('주문 조회 권한이 없는 상담 역할도 그 고객의 구매이력을 금액·상태와 함께 버튼 없이 본다', () => {
    const html = render({ detail, selected: true, canReadOrders: false, purchaseHistory });
    expect(html).toContain('전체 구매이력'); expect(html).toContain('합성 키링'); expect(html).toContain('12,000원');
    expect(html).toMatch(/data-tone="[^"]+"[^>]*>신규주문</);
    expect(html).toContain('연결 주문 20261019120010000001'); expect(html).toContain('합성 연결 상품 · 2개 · 15,000원');
    expect(html).toMatch(/<nav aria-label="구매이력 페이지"[^>]*><span[^>]*>1–1 \/ 전체 1건 · 1 \/ 1 페이지<\/span>/);
    expect(html).not.toContain('구매이력 불러오기');
    /* 주문 화면을 열 수 없는 역할에는 주문 상세 링크를 두지 않는다. */
    expect(html).not.toContain('/admin/sales/orders/'); expect(html).not.toContain('주문 상세');
  });
  it('주문 조회 권한이 있으면 같은 구매이력에 주문 상세 링크를 둔다', () => {
    const html = render({ detail, selected: true, canReadOrders: true, purchaseHistory });
    expect(html).toContain('합성 키링'); expect(html).toContain('href="/admin/sales/orders/a20c0000-0000-4000-8000-000000000401"');
    expect(html).toContain('주문 상세 열기');
    /* 다른 문의의 미리 읽은 이력은 쓰지 않는다. */
    const other = render({ detail, selected: true, canReadOrders: true, purchaseHistory: { ...purchaseHistory, inquiryId: 'a20c0000-0000-4000-8000-000000000209' } });
    expect(other).not.toContain('합성 키링'); expect(other).toContain('구매이력 불러오기');
    expect(render({ detail, selected: true, canReadOrders: true, purchaseHistoryError: true })).toContain('구매이력을 자동으로 불러오지 못했습니다');
  });
  it('연결 주문을 확인할 수 없으면(구매이력 실패·권한 없음) 연결 주문 없음으로 말하지 않는다', () => {
    const failed = render({ detail, selected: true, canReadOrders: false, purchaseHistoryError: true });
    expect(failed).not.toContain('연결된 주문이 없습니다.'); expect(failed).toContain('구매이력을 자동으로 불러오지 못했습니다');
    expect(render({ detail, selected: true, canReadOrders: false, purchaseHistory: { ...purchaseHistory, linkedOrder: null } })).toContain('연결된 주문이 없습니다.');
  });
  /* 1014-105: 담당 지정·변경·답변·완료를 누가 언제 했는지 상담 정보에 접어 둔다. */
  it('처리 이력을 상담 정보에 보이고, 불러오지 못하면 빈 이력으로 보이지 않는다', () => {
    const history = { ok: true as const, value: { inquiryId: ID, total: 3, limit: 100, events: [
      { id: 'e1', at: '2026-10-20T01:10:00Z', kind: 'assigned' as const, actorName: '상담원 가', fromName: null, toName: '상담원 가', reason: null },
      { id: 'e2', at: '2026-10-20T01:10:00Z', kind: 'answered' as const, actorName: '상담원 가', fromName: null, toName: null, reason: null },
      { id: 'e3', at: '2026-10-20T02:00:00Z', kind: 'reassigned' as const, actorName: '매니저 나', fromName: '상담원 가', toName: null, reason: '휴가 인계' },
    ] } };
    const html = render({ detail: { ...detail, history }, selected: true });
    expect(html).toContain('처리 이력'); expect(html).toContain('첫 답변으로 담당 지정 · 상담원 가'); expect(html).toContain('담당 변경 · 상담원 가 → 미배정');
    expect(html).toContain('사유 · 휴가 인계'); expect(html).toContain('매니저 나');
    expect(render({ detail: { ...detail, history: { ok: false } }, selected: true })).toContain('처리 이력을 불러오지 못했습니다');
    expect(render({ detail, selected: true })).not.toContain('data-inquiry-history-card');
  });
});
