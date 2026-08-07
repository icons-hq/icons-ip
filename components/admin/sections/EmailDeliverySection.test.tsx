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
