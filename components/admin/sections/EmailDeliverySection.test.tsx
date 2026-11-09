import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import { EmailDeliverySection } from './EmailDeliverySection';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
  };
});
vi.mock('@/app/admin/order-actions', () => ({ resendOrderEmailAction: vi.fn() }));

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const failedDelivery: EmailDeliveryRecord = {
  dedupeKey: `order_confirmation:${ORDER_ID}`,
  template: 'order_confirmation',
  templateLabel: '주문 확인',
  orderId: ORDER_ID,
  recipient: 'buyer@example.com',
  subject: '[ICONS] 주문이 접수됐어요',
  status: 'failed',
  attemptCount: 2,
  lastError: 'resend 429',
  claimedAt: '2026-08-07T02:30:00.000Z',
  completedAt: '2026-08-07T02:30:01.000Z',
  createdAt: '2026-08-07T02:00:00.000Z',
  resendable: true,
};

/* 문의 답변 메일은 주문 상태로 사실성을 판정할 수 없어 재발송 게이트가 거절한다(#253).
   누르면 반드시 실패하는 버튼을 그리는 대신 이유를 적는다. */
const inquiryDelivery: EmailDeliveryRecord = {
  ...failedDelivery,
  dedupeKey: 'inquiry_answered:5f2b9c11-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
  template: 'inquiry_answered',
  templateLabel: '문의 답변',
  orderId: null,
  subject: '[ICONS] 문의에 답변이 등록됐어요',
  resendable: false,
};

describe('EmailDeliverySection', () => {
  // SQL 콘솔 없이 실패를 보고 다시 보낼 수 있어야 한다.
  it('실패한 발송을 사유와 재발송 버튼과 함께 보여준다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[failedDelivery]} />);

    expect(html).toContain('주문 확인');
    expect(html).toContain('buyer@example.com');
    expect(html).toContain('resend 429');
    expect(html).toContain('2회 시도');
    expect(html).toContain('다시 보내기');
    expect(html).toContain(`value="order_confirmation:${ORDER_ID}"`);
  });

  it('다시 보낼 건이 없으면 빈 상태를 알린다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[]} />);

    expect(html).toContain('다시 보낼 메일이 없습니다');
    expect(html).not.toContain('다시 보내기');
  });
});

describe('EmailDeliverySection · 주문에 매이지 않는 메일', () => {
  it('문의 답변 메일에는 재발송 버튼 대신 이유를 보여준다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[inquiryDelivery]} />);

    expect(html).toContain('문의 답변');
    expect(html).not.toContain('다시 보내기');
    expect(html).toContain('1:1 문의 화면에서 답변을 다시 등록해주세요');
  });

  /* DB가 원문을 가린 값(legacy_*·masked)은 코드 그대로 보이지 않고, 줄마다의 안내는 메일 종류를 따른다. */
  it('가려진 코드를 사람 말로 바꾸고 주문 메일에 문의 답변 안내를 붙이지 않는다', () => {
    const redacted: EmailDeliveryRecord = {
      ...failedDelivery,
      dedupeKey: 'order_shipped:legacy-key',
      template: 'order_shipped',
      templateLabel: '배송 시작',
      orderId: null,
      recipient: 'masked',
      subject: 'legacy_order_shipped',
      lastError: 'legacy_unverified',
      resendable: false,
    };
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[redacted]} />);

    for (const code of ['legacy_order_shipped', 'legacy_unverified', '받는 사람 masked']) expect(html).not.toContain(code);
    expect(html).toContain('상세 사유는 개인정보 보호로 저장하지 않습니다.');
    expect(html).toContain('대상 주문을 확인할 수 없어');
    expect(html).not.toContain('1:1 문의 화면');
    expect(html).not.toContain('다시 보내기');
  });

  /* 줄에 버튼이 없는데 '줄의 다시 보내기로 보내라'고 하면 운영자는 버튼을 찾아 헤맨다. */
  it('다시 보낼 수 있는 건이 없으면 누르라고 하지 않고 없다고 말한다', () => {
    const legacy: EmailDeliveryRecord = { ...failedDelivery, dedupeKey: 'order_confirmation:legacy-key', orderId: null, recipient: 'masked', subject: 'legacy_order_confirmation', lastError: 'legacy_unverified', resendable: false };
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[legacy]} />);

    expect(html).toContain('지금 이 화면에서 다시 보낼 수 있는 메일이 없습니다.');
    expect(html).not.toContain('줄의 다시 보내기로');
    expect(html).toContain('주문·받는 사람이 보관되지 않은 기록');
    expect(html).not.toMatch(/text-destructive[^>]*>실패 사유: 상세 사유/);
  });

  /* 글 나열이면 실패 건을 훑어 비교할 수 없다. 칸이 나뉜 표로 그리고, 사람이 할 일이 있는 줄만 주의색으로 세우고, 되풀이하던 안내는 표 위 한 번으로 줄인다. */
  it('실패 건을 칸이 나뉜 표로 보이고 할 일이 있는 줄만 주의색이며 안내는 한 번만 나온다', () => {
    const redacted = (template: EmailDeliveryRecord['template'], templateLabel: string): EmailDeliveryRecord => ({ ...failedDelivery, dedupeKey: `${template}:legacy-key`, template, templateLabel, orderId: null, recipient: 'masked', subject: `legacy_${template}`, lastError: 'legacy_unverified', resendable: false });
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[redacted('order_shipped', '배송 시작'), redacted('inquiry_answered', '문의 답변'), redacted('order_confirmation', '주문 확인')]} />);

    for (const head of ['유형', '제목·요약', '상태', '마지막 시도', '다음 행동']) expect(html).toMatch(new RegExp(`<th[^>]*>${head}</th>`));
    expect(html.match(/data-slot="table-row"/g)).toHaveLength(4);
    expect(html.match(/상세 사유는 개인정보 보호로 저장하지 않습니다\./g)).toHaveLength(1);
    expect(html.match(/주문·받는 사람이 보관되지 않은 기록/g)).toHaveLength(1);
    expect(html).toMatch(/text-warning[^>]*>(?:<svg[\s\S]*?<\/svg>)?1:1 문의 화면에서 답변을 다시 등록해주세요</);
    expect(html.match(/text-warning/g)).toHaveLength(1);
    expect(html.match(/대상 주문을 확인할 수 없어/g)).toHaveLength(2);
    expect(html).toContain('주황색으로 적힌 일만 직접 처리해주세요');
    /* 대상 문의를 찾을 값이 없으니 링크로 만들지 않는다. */
    expect(html).not.toContain('href="/admin/cs/inquiries');
  });

  /* 결과를 아직 모르는 문의 답변에 다시 등록하라고 하면 답변이 두 번 나간다. */
  it('결과 확인 중인 문의 답변에는 다시 등록을 권하지 않는다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[{ ...inquiryDelivery, status: 'pending', lastError: null }]} />);

    expect(html).toContain('발송 결과를 확인하는 중입니다');
    expect(html).not.toContain('다시 등록해주세요');
  });

  it('다시 보낼 수 있는 건은 주문으로 가는 링크와 건수를 보인다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[failedDelivery]} />);

    expect(html).toContain(`href="/admin/sales/orders/${ORDER_ID}"`);
    expect(html).toContain('지금 다시 보낼 수 있음');
    expect(html).toContain('줄의 다시 보내기로');
  });

  it('실패 건수를 위에 보이고 실패한 건을 먼저 보여준다', () => {
    const pending: EmailDeliveryRecord = { ...failedDelivery, dedupeKey: `order_shipped:${ORDER_ID}`, template: 'order_shipped', templateLabel: '배송 시작', status: 'pending', lastError: null, claimedAt: '2026-08-08T02:30:00.000Z' };
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[pending, failedDelivery]} />);

    expect(html).toContain('발송 실패');
    expect(html.indexOf('data-email-delivery-summary')).toBeLessThan(html.indexOf('메일 발송 이력 목록'));
    expect(html.indexOf('주문 확인 메일은')).toBeLessThan(html.indexOf('메일 발송 이력 목록'));
    expect(html.indexOf(`order_confirmation:${ORDER_ID}`)).toBeLessThan(html.indexOf(`order_shipped:${ORDER_ID}`));
  });
});
