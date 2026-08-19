import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminInquiryConsoleData } from '@/lib/admin/inquiries';
import { InquiryQueueScreen } from './InquiryQueueScreen';

const NOW = new Date('2026-08-20T06:00:00.000Z');
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function data(overrides: Partial<AdminInquiryConsoleData> = {}): AdminInquiryConsoleData {
  return {
    counts: { open: 2, answered: 5, closed: 0 },
    filters: {
      category: 'all',
      field: 'all',
      from: null,
      page: 1,
      query: '',
      status: 'open',
      to: null,
    },
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
        createdAt: '2026-08-18T01:00:00.000Z',
        lastMessageAt: '2026-08-18T01:00:00.000Z',
        answeredAt: null,
        messageCount: 1,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reference: 11,
        category: 'claim',
        title: '반품하고 싶어요',
        status: 'answered',
        buyerName: 'second_fan',
        buyerEmail: null,
        orderId: null,
        goodId: 'g13',
        goodName: '아크릴 블록',
        handlerName: 'cs_lead',
        createdAt: '2026-08-20T02:00:00.000Z',
        lastMessageAt: '2026-08-20T05:00:00.000Z',
        answeredAt: '2026-08-20T05:00:00.000Z',
        messageCount: 3,
      },
    ],
    ...overrides,
  };
}

describe('InquiryQueueScreen', () => {
  it('이슈가 요구한 큐 컬럼을 순서대로 보여준다', () => {
    const html = renderToStaticMarkup(<InquiryQueueScreen data={data()} now={NOW} />);

    for (const column of ['문의번호', '유형', '제목', '구매자', '연결 주문', '상태', '접수 · 최근', '1차 답변 기한', '처리자']) {
      expect(html).toContain(column);
    }
    expect(html).toContain('#12');
    expect(html).toContain('배송이 아직 안 왔어요');
    expect(html).toContain('@maple_fan');
    expect(html).toContain('취소/반품/교환');
  });

  /* SLA는 목록에서 가장 먼저 보는 값이다. 색만이 아니라 톤 속성으로 강조가 남아야 한다. */
  it('기한을 넘긴 미답변을 danger 톤으로 표시한다', () => {
    const html = renderToStaticMarkup(<InquiryQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('data-sla-tone="danger"');
    expect(html).toContain('기한 초과');
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계 실패"를 구분할 수 없다. */
  it('종결 0건도 칩으로 남긴다', () => {
    const html = renderToStaticMarkup(<InquiryQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('종결 0건');
    expect(html).toContain('미답변 2건');
  });

  it('상세 링크가 목록 조건을 함께 들고 간다', () => {
    const html = renderToStaticMarkup(<InquiryQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('/admin/cs/inquiries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?back=');
  });

  /* 문의는 대화이고 클레임은 절차다. 이 화면이 클레임을 처리하는 척하면 안 된다. */
  it('클레임 처리는 주문 콘솔로 넘긴다', () => {
    const html = renderToStaticMarkup(<InquiryQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('/admin/sales/orders');
  });

  it('행이 없으면 조건에 맞는 문의가 없다고 알린다', () => {
    const html = renderToStaticMarkup(
      <InquiryQueueScreen data={data({ rows: [], total: 0 })} now={NOW} />,
    );

    expect(html).toContain('조건에 맞는 문의가 없습니다.');
  });
});
