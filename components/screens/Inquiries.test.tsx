import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InquiryListItem } from '@/lib/inquiries.server';
import { Inquiries } from './Inquiries';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const items: InquiryListItem[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reference: 12,
    category: 'order',
    categoryLabel: '주문/배송',
    title: '배송이 아직 안 왔어요',
    status: 'answered',
    orderId: ORDER_ID,
    goodId: null,
    createdAt: '2026-08-18T01:00:00.000Z',
    lastMessageAt: '2026-08-19T01:00:00.000Z',
    answeredAt: '2026-08-19T01:00:00.000Z',
    closedAt: null,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reference: 9,
    category: 'account',
    categoryLabel: '계정',
    title: '이메일을 바꾸고 싶어요',
    status: 'closed',
    orderId: null,
    goodId: null,
    createdAt: '2026-08-01T01:00:00.000Z',
    lastMessageAt: '2026-08-05T01:00:00.000Z',
    answeredAt: '2026-08-02T01:00:00.000Z',
    closedAt: '2026-08-09T01:00:00.000Z',
  },
];

describe('Inquiries', () => {
  it('보낸 문의를 문의번호·유형·상태와 함께 보여준다', () => {
    const html = renderToStaticMarkup(<Inquiries inquiries={items} />);

    expect(html).toContain('#12');
    expect(html).toContain('주문/배송');
    expect(html).toContain('답변 완료');
    expect(html).toContain('배송이 아직 안 왔어요');
    expect(html).toContain('/my/inquiries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  /* 종결된 문의를 감추면 지난 답변을 못 찾은 사용자가 같은 질문을 다시 보낸다. */
  it('종결된 문의도 목록에 남긴다', () => {
    const html = renderToStaticMarkup(<Inquiries inquiries={items} />);

    expect(html).toContain('이메일을 바꾸고 싶어요');
    expect(html).toContain('종결');
  });

  it('보낸 문의가 없으면 빈 상태와 새 문의 경로를 보여준다', () => {
    const html = renderToStaticMarkup(<Inquiries inquiries={[]} />);

    expect(html).toContain('아직 보낸 문의가 없습니다.');
    expect(html).toContain('/my/inquiries/new');
  });

  /* 답변 후 7일 자동 종결은 사용자가 미리 알아야 하는 규칙이다. */
  it('자동 종결 규칙을 안내한다', () => {
    const html = renderToStaticMarkup(<Inquiries inquiries={items} />);

    expect(html).toContain('7일');
    expect(html).toContain('종결된 문의도 계속 열람할 수 있습니다');
  });
});
