import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { InquiryDetailScreen } from './InquiryDetailScreen';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
/* next/link의 이동 옵션(scroll·replace)은 DOM에 남지 않아 data 속성으로 드러낸다. */
vi.mock('next/link', () => ({
  default: ({ children, href, scroll, replace, ...rest }: { children?: React.ReactNode; href: string; scroll?: boolean; replace?: boolean } & Record<string, unknown>) => (
    <a href={href} data-scroll={scroll === false ? 'false' : undefined} data-replace={replace ? 'true' : undefined} {...rest}>{children}</a>
  ),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
  };
});
vi.mock('@/app/admin/inquiry-actions', () => ({
  answerInquiryAction: vi.fn(),
  reassignInquiryAction: vi.fn(),
  addInquiryInternalNoteAction: vi.fn(),
  closeInquiryAction: vi.fn(),
}));
vi.mock('@/app/admin/inquiry-reply-template-actions', () => ({ listInquiryReplyTemplatesAction: vi.fn(), mutateInquiryReplyTemplateAction: vi.fn(), readInquiryReplyTemplateAction: vi.fn(), readInquiryTemplateOperationAction: vi.fn() }));
vi.mock('@/app/admin/customer-actions', () => ({ loadCustomerHistoryAction: vi.fn() }));

const INQUIRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-20T06:00:00.000Z');

function detail(overrides: Partial<AdminInquiryDetail> = {}): AdminInquiryDetail {
  return {
    inquiry: {
      id: INQUIRY_ID,
      reference: 12,
      category: 'order',
      title: '배송이 아직 안 왔어요',
      status: 'open',
      buyerName: 'maple_fan',
      buyerEmail: 'buyer@example.com',
      orderId: ORDER_ID,
      goodId: null,
      goodName: null,
      handlerName: null,
      assigneeId: null,
      assigneeName: null,
      waitingSince: '2026-08-18T01:00:00.000Z',
      createdAt: '2026-08-18T01:00:00.000Z',
      lastMessageAt: '2026-08-18T01:00:00.000Z',
      answeredAt: null,
      messageCount: 1,
      closedAt: null,
      userId: '33333333-3333-4333-8333-333333333333',
    },
    messages: [
      {
        id: 'm1',
        author: 'user',
        authorName: null,
        body: '주문한 지 일주일이 지났어요',
        imageUrls: ['https://signed.example/a.png'],
        createdAt: '2026-08-18T01:00:00.000Z',
      },
    ],
    order: {
      id: ORDER_ID,
      status: 'shipping',
      total: 57000,
      createdAt: '2026-08-11T01:00:00.000Z',
      shipments: [shipmentFixture({trackingNumber:'1234567890'})],
      itemCount: 4,
      leadItemName: '아크릴 블록',
      payment: { provider: 'korpay', status: 'paid', amount: 57000 },
      claims: [
        { status: 'requested', requestedAt: '2026-08-17T01:00:00.000Z', decidedAt: null, reasonType: 'change_of_mind' },
      ],
    },
    buyer: {
      id: '33333333-3333-4333-8333-333333333333',
      nickname: 'maple_fan',
      email: 'buyer@example.com',
      suspendedAt: null,
      orderCount: 6,
      inquiryCount: 3,
      openInquiryCount: 1,
    },
    staffOptions: [],
    notes: [],
    ...overrides,
  };
}

function render(input = detail()) {
  return renderToStaticMarkup(
    <InquiryDetailScreen backHref="/admin/cs/inquiries?status=open&page=1" detail={input} now={NOW} />,
  );
}

describe('InquiryDetailScreen', () => {
  it('목록 아래 작업 영역에서도 답변 작성은 한 번만 렌더하고 문의·주문 근거를 보존한다', () => {
    const html = renderToStaticMarkup(<InquiryDetailScreen embedded backHref="/admin/cs/inquiries" detail={detail()} now={NOW} />);
    expect(html).toContain('고객문의 내용 보기');
    expect(html).toContain('aria-label="판매자 답변 처리"');
    expect(html.match(/<strong>답변 작성<\/strong>/g)).toHaveLength(1);
    expect(html).toContain('주문한 지 일주일이 지났어요');
    expect(html).toContain(`/admin/sales/orders/${ORDER_ID}`);
    expect(html).not.toContain('<dialog');
  });

  /* 팝업 안 '← 문의 목록'은 닫기와 같다. 기본 이동(scroll=true)은 목록을 맨 위로 올려, 80번째 행에서
     연 팝업을 닫으면 보던 위치를 잃는다(R4). X·Esc처럼 스크롤을 두고 기록을 바꿔 쓴다. */
  it('팝업 안 문의 목록 링크는 스크롤을 건드리지 않고 닫는다', () => {
    const embedded = renderToStaticMarkup(<InquiryDetailScreen embedded backHref="/admin/cs/inquiries?page=3" detail={detail()} now={NOW} />);
    expect(embedded).toMatch(/<a href="\/admin\/cs\/inquiries\?page=3" data-scroll="false" data-replace="true"[^>]*>← 문의 목록<\/a>/);
    expect(render()).toMatch(/<a href="\/admin\/cs\/inquiries\?status=open&amp;page=1" class="mono"[^>]*>← 문의 목록<\/a>/);
  });

  it('자동 안내가 있어도 답변자·담당자로 표시하지 않고 미답변 기한을 유지한다', () => {
    const html=render(detail({messages:[{id:'system',author:'system',authorName:null,body:'FAQ https://iconsip.com/help',imageUrls:[],createdAt:'2026-08-18T01:00:01Z'}]}));
    expect(html).toContain('자동 안내');
    expect(html).toContain('기한 초과');
    expect(html).toContain('href="https://iconsip.com/help"');
    expect(html).not.toContain('ICONS 운영자');
  });
  it('고객 ID 상세 링크와 화면 안의 고객 이력 패널을 제공한다', () => {
    const html = render();
    expect(html).toContain('/admin/customers/33333333-3333-4333-8333-333333333333');
    expect(html).toContain('aria-label="고객 이력"');
  });
  it('연결 주문을 페이지 필터와 무관한 정확한 상세 주소로 연다', () => {
    expect(render()).toContain(`/admin/sales/orders/${ORDER_ID}`);
  });
  it('내부 메모는 고객 답변과 구분해 작성자와 함께 보여준다', () => {
    const html = render(detail({ notes: [{ id: 'n1', authorName: '지우', body: '물류팀 재확인 필요', createdAt: '2026-08-20T01:00:00Z' }] }));
    expect(html).toContain('내부 메모 · 고객 비노출');
    expect(html).toContain('물류팀 재확인 필요');
    expect(html).toContain('변경 사유');
    expect(html).toContain('담당자 변경');
  });

  it('각 답변에 실제 답변자의 표시명을 보여준다', () => {
    const html = render(detail({ messages: [
      { id: 'staff-a', author: 'staff', authorName: '수민', body: '확인했습니다.', imageUrls: [], createdAt: '2026-08-20T01:00:00Z' },
      { id: 'staff-b', author: 'staff', authorName: '지우', body: '발송했습니다.', imageUrls: [], createdAt: '2026-08-20T02:00:00Z' },
    ] }));
    expect(html).toContain('수민');
    expect(html).toContain('지우');
  });

  /* 컨텍스트 패널이 이 화면의 존재 이유다 — 없으면 CS가 주문 콘솔을 오간다. */
  it('연결 주문의 상태·결제·운송장·클레임 이력을 한 화면에 싣는다', () => {
    const html = render();

    expect(html).toContain('배송중');
    expect(html).toContain('Korpay');
    expect(html).toContain('한진택배');
    expect(html).toContain('1234567890');
    expect(html).toContain('승인 대기');
    expect(html).toContain('₩57,000');
  });

  it('구매자 이력을 함께 보여준다', () => {
    const html = render();

    expect(html).toContain('6건');
    expect(html).toContain('총 3건 · 진행 중 1건');
  });

  it('스레드와 첨부를 보여준다', () => {
    const html = render();

    expect(html).toContain('주문한 지 일주일이 지났어요');
    expect(html).toContain('https://signed.example/a.png');
  });

  it('연결 주문이 없으면 없다고 말하고 지어내지 않는다', () => {
    const input = detail();
    const html = render({ ...input, order: null, inquiry: { ...input.inquiry, orderId: null } });

    expect(html).toContain('연결된 주문이 없습니다.');
    expect(html).not.toContain('한진택배');
  });

  /* 종결된 문의에 답변 입력창을 남기면 보냈다고 믿는 글이 어디에도 도착하지 않는다. */
  it('종결된 문의에는 답변 폼 대신 종결 안내를 둔다', () => {
    const input = detail();
    const html = render({
      ...input,
      inquiry: { ...input.inquiry, status: 'closed', closedAt: '2026-08-20T00:00:00.000Z' },
    });

    expect(html).toContain('종결된 문의입니다.');
    expect(html).not.toContain('답변 발송');
  });

  it('미종결 문의에는 템플릿과 답변 발송·종결 버튼을 둔다', () => {
    const html = render();

    expect(html).toContain('답변 템플릿 불러오기');
    expect(html).toContain('답변 발송');
    expect(html).toContain('지금 종결');
  });
});

it('CS-only managers do not receive order or global customer entry points', () => {
  const html = renderToStaticMarkup(<InquiryDetailScreen backHref="/admin/cs/inquiries" detail={detail()} now={NOW} canReadOrders={false} canManageSales={false} canViewCustomer={false} />);
  expect(html).toContain('주문한 지 일주일이 지났어요');
  for (const text of ['연결 주문', '주문 콘솔에서 열기', '고객 상세 열기', '고객 이력', '클레임 이력', ORDER_ID]) expect(html).not.toContain(text);
});
