import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  TicketCancellation,
  ticketCancellationRetryAvailable,
  ticketCancellationPresentation,
  submitTicketCancellation,
} from './TicketCancellation';
import type { TicketOrderDetail } from '../../lib/ticketing';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const order: TicketOrderDetail = {
  id: '5cbcbfed-202d-4676-821a-7706398e57c0',
  eventId: 'maple-popup',
  eventTitle: '메이플 팝업',
  ticketTypeId: '7ad4c967-3d48-44da-a665-64731ac33f62',
  ticketTypeName: '7월 25일 오후 회차',
  qty: 2,
  total: 44000,
  status: 'paid',
  paymentStatus: 'paid',
  createdAt: '2026-07-14T02:00:00.000Z',
  startsAt: '2026-07-25T05:00:00.000Z',
  endsAt: '2026-07-25T08:00:00.000Z',
  location: '성수 ICONS 팝업',
  tickets: [
    { id: '19b0d848-7192-4b40-a675-f508822f99c9', status: 'valid' },
    { id: '2ab1e959-8203-4c51-b786-0619933a00da', status: 'valid' },
  ],
  cancellationRequest: null,
  refund: null,
};

describe('ticket cancellation UI contract', () => {
  it.each(['canceled', 'already_canceled', 'processing', 'reviewing'] as const)(
    'posts only the order path and accepts safe status %s',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status }), {
        status: status === 'processing' || status === 'reviewing' ? 202 : 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      await expect(submitTicketCancellation(order.id, fetcher)).resolves.toBe(status);
      expect(fetcher).toHaveBeenCalledWith(`/api/ticket-orders/${order.id}/cancel`, { method: 'POST' });
      expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
    },
  );

  it('fails closed without parsing a non-success provider response', async () => {
    const json = vi.fn().mockResolvedValue({ error: { code: 'private-provider-state' } });
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json });

    await expect(submitTicketCancellation(order.id, fetcher)).resolves.toBe(false);
    expect(json).not.toHaveBeenCalled();
  });

  it('shows whole-booking, zero-fee, full-refund policy before the event starts', () => {
    const presentation = ticketCancellationPresentation(order, Date.parse('2026-07-15T03:00:00.000Z'));
    expect(presentation).toMatchObject({ canCancel: true, actionLabel: '예매 전체 취소' });

    const html = renderToStaticMarkup(createElement(TicketCancellation, {
      now: Date.parse('2026-07-15T03:00:00.000Z'),
      order,
    }));
    expect(html).toContain('예매 전체 취소');
    expect(html).toContain('취소 수수료');
    expect(html).toContain('<dd>0원</dd>');
    expect(html).toContain('44,000원 전액 환불');
  });

  it('does not promise a refund amount when a pending booking has no payment ledger', () => {
    const html = renderToStaticMarkup(createElement(TicketCancellation, {
      now: Date.parse('2026-07-15T03:00:00.000Z'),
      order: { ...order, status: 'pending', paymentStatus: null },
    }));

    expect(html).toContain('결제 내역 없음');
    expect(html).toContain('결제된 금액 전액');
    expect(html).not.toContain('44,000원 전액 환불');
  });

  it.each([
    ['requested', '취소 요청을 접수했어요'],
    ['processing', '결제 취소를 처리하고 있어요'],
    ['needs_review', '환불 결과를 확인하고 있어요'],
    ['completed', '취소·환불이 완료됐어요'],
  ] as const)('shows durable %s state and removes the action', (status, copy) => {
    const request = {
      status,
      requestedAt: '2026-07-15T02:00:00.000Z',
      completedAt: status === 'completed' ? '2026-07-15T02:30:00.000Z' : null,
      grossAmount: 44000,
      feeAmount: 0,
      refundAmount: 44000,
    };
    const html = renderToStaticMarkup(createElement(TicketCancellation, {
      now: Date.parse('2026-07-15T03:00:00.000Z'),
      order: { ...order, cancellationRequest: request },
    }));

    expect(html).toContain(copy);
    expect(html).not.toContain('>예매 전체 취소</button>');
    expect(html).not.toMatch(/paymentKey|attempt_token|last_error/i);
  });

  it('offers idempotent reconciliation for requested, needs_review, and processing without exposing a new cancellation action', () => {
    const request = {
      status: 'needs_review' as const,
      requestedAt: '2026-07-15T02:00:00.000Z',
      completedAt: null,
      grossAmount: 44000,
      feeAmount: 0,
      refundAmount: 44000,
    };
    const needsReview = renderToStaticMarkup(createElement(TicketCancellation, {
      order: { ...order, cancellationRequest: request },
    }));
    const requested = renderToStaticMarkup(createElement(TicketCancellation, {
      order: { ...order, cancellationRequest: { ...request, status: 'requested' as const } },
    }));
    const processing = renderToStaticMarkup(createElement(TicketCancellation, {
      order: { ...order, cancellationRequest: { ...request, status: 'processing' as const } },
    }));

    expect(requested).toContain('환불 상태 다시 확인');
    expect(requested).not.toContain('예매 전체 취소');
    expect(needsReview).toContain('환불 상태 다시 확인');
    expect(needsReview).not.toContain('예매 전체 취소');
    expect(processing).toContain('환불 상태 다시 확인');
    expect(processing).not.toContain('예매 전체 취소');
  });

  it('restores reconciliation after a settled 202 state while blocking only an in-flight request', () => {
    expect(ticketCancellationRetryAvailable('requested', 'idle')).toBe(true);
    expect(ticketCancellationRetryAvailable('processing', 'processing')).toBe(true);
    expect(ticketCancellationRetryAvailable('needs_review', 'processing')).toBe(true);
    expect(ticketCancellationRetryAvailable('processing', 'submitting')).toBe(false);
    expect(ticketCancellationRetryAvailable('needs_review', 'submitting')).toBe(false);
    expect(ticketCancellationRetryAvailable('processing', 'success')).toBe(false);
  });
});
