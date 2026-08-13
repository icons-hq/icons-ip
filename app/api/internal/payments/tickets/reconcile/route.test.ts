import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketPaymentReconciliationInProgressError,
} from '@/lib/payments/ticket-checkout';
import { POST } from './route';

const attemptId = '30000000-0000-4000-8000-000000000206';
const mocks = vi.hoisted(() => ({
  reconciliationAvailable: true,
  checkoutAvailable: false,
  reconcile: vi.fn(),
}));

vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketPaymentReconciliationAvailable: () => mocks.reconciliationAvailable,
  ticketCheckoutPaymentsEnabled: () => mocks.checkoutAvailable,
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: () => ({
    reconcilePayment: mocks.reconcile,
    reconcileRefund: mocks.reconcile,
  }),
}));

function request(
  secret = 'ticket-reconciliation-secret',
  body: unknown = {
    operation: 'payment',
    attemptId,
    caseRef: 'case_ticket_opaque_206',
  },
) {
  return new Request('https://icons.local/api/internal/payments/tickets/reconcile', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/payments/tickets/reconcile', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', 'ticket-reconciliation-secret');
    vi.stubEnv('CRON_SECRET', 'retired-shared-cron-secret');
    mocks.reconciliationAvailable = true;
    mocks.checkoutAvailable = false;
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue({ attemptId, provider: 'korpay', outcome: 'approved' });
  });

  it('신규 checkout OFF에서도 전용 secret과 opaque case로 기존 건만 재조정한다', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ attemptId, outcome: 'approved' });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      attemptId,
      caseRef: 'case_ticket_opaque_206',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.checkoutAvailable).toBe(false);
  });

  it('legacy CRON secret·미인증·provider OFF·잘못된 case ref는 provider 호출 전에 차단한다', async () => {
    expect((await POST(request('wrong-secret'))).status).toBe(401);
    expect((await POST(request('retired-shared-cron-secret'))).status).toBe(401);

    mocks.reconciliationAvailable = false;
    expect((await POST(request())).status).toBe(503);
    mocks.reconciliationAvailable = true;

    expect((await POST(request('ticket-reconciliation-secret', {
      operation: 'payment',
      attemptId: 'not-a-uuid',
      caseRef: 'case_ticket_opaque_206',
    }))).status)
      .toBe(400);
    expect((await POST(request('ticket-reconciliation-secret', {
      operation: 'payment',
      attemptId,
      caseRef: 'staff@example.test',
    }))).status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('미설정 또는 malformed configured secret은 exact bearer여도 fail closed한다', async () => {
    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', 'too-short');
    expect((await POST(request('too-short'))).status).toBe(401);

    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', 'invalid-secret-with-$ymbol');
    expect((await POST(request('invalid-secret-with-$ymbol'))).status).toBe(401);

    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', '');
    expect((await POST(request(''))).status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('모호·처리 중 상태를 fulfillment 성공으로 가장하지 않는다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ attemptId, provider: 'korpay', outcome: 'unknown' });
    const unknown = await POST(request());
    expect(unknown.status).toBe(202);
    await expect(unknown.json()).resolves.toEqual({ attemptId, outcome: 'unknown' });

    mocks.reconcile.mockRejectedValueOnce(new TicketPaymentReconciliationInProgressError());
    const inProgress = await POST(request());
    expect(inProgress.status).toBe(202);
    await expect(inProgress.json()).resolves.toEqual({ outcome: 'unknown' });
  });

  it('refund operation은 request id를 payment reconciliation과 구분해 전달한다', async () => {
    const requestId = '40000000-0000-4000-8000-000000000206';
    mocks.reconcile.mockResolvedValue({
      attemptId,
      provider: 'korpay',
      outcome: 'approved',
      refundedAmount: 44_000,
    });

    const response = await POST(request('ticket-reconciliation-secret', {
      operation: 'refund',
      requestId,
      caseRef: 'case_refund_opaque_206',
    }));

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      requestId,
      caseRef: 'case_refund_opaque_206',
    });
  });
});
