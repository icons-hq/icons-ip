import { describe, expect, it, vi } from 'vitest';
import { GoodsPaymentReconciliationInProgressError } from '@/lib/payments/goods-checkout';
import { createTossWebhookHandler } from './route';

const PROVIDER_ORDER_ID = 'O30000000000040008000000000000390';
const TICKET_PROVIDER_ORDER_ID = 'T30000000000040008000000000000390';
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000390';
const TRANSMISSION_ID = 'whtrans_a01j70335nkqqeg0zwzz2r4py9z';
const PAYMENT_KEY = 'webhook-payment-key-should-not-leak';

function webhookRequest(
  body: unknown,
  headers: HeadersInit = {},
  rawBody?: string,
) {
  return new Request('https://icons.example/api/webhooks/tosspayments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody ?? JSON.stringify(body),
  });
}

function statusChangedBody(overrides: Record<string, unknown> = {}) {
  return {
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-09-01T00:00:00.000000',
    data: {
      paymentKey: PAYMENT_KEY,
      orderId: PROVIDER_ORDER_ID,
      status: 'DONE',
      ...overrides,
    },
  };
}

function handler(overrides: Partial<Parameters<typeof createTossWebhookHandler>[0]> = {}) {
  const deps = {
    available: () => true,
    loadAttempt: vi.fn(async () => ({
      id: ATTEMPT_ID,
      purpose: 'order' as const,
      state: 'unknown',
    })),
    reconcileGoods: vi.fn(async () => ({ outcome: 'approved' })),
    reconcileTicket: vi.fn(async () => ({ outcome: 'approved' })),
    createCaseRefFallback: () => '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
  return { deps, post: createTossWebhookHandler(deps) };
}

describe('POST /api/webhooks/tosspayments', () => {
  it('본문을 신뢰하지 않는다 — orderId로 attempt를 찾아 재정합 seam에 태울 뿐이다', async () => {
    const { deps, post } = handler();

    const result = await post(webhookRequest(
      // 본문의 status가 무엇이든 반영 근거가 아니다.
      statusChangedBody({ status: 'CANCELED', totalAmount: 999_999 }),
      { 'tosspayments-webhook-transmission-id': TRANSMISSION_ID },
    ));

    expect(result.status).toBe(200);
    expect(deps.loadAttempt).toHaveBeenCalledWith(PROVIDER_ORDER_ID);
    expect(deps.reconcileGoods).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      caseRef: TRANSMISSION_ID,
    });
    expect(deps.reconcileTicket).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain(PAYMENT_KEY);
  });

  it('티켓 attempt는 티켓 재정합 seam으로 보낸다', async () => {
    const { deps, post } = handler({
      loadAttempt: vi.fn(async () => ({
        id: ATTEMPT_ID,
        purpose: 'ticket' as const,
        state: 'confirming',
      })),
    });

    const result = await post(webhookRequest(
      statusChangedBody({ orderId: TICKET_PROVIDER_ORDER_ID }),
      { 'tosspayments-webhook-transmission-id': TRANSMISSION_ID },
    ));

    expect(result.status).toBe(200);
    expect(deps.reconcileTicket).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      caseRef: TRANSMISSION_ID,
    });
    expect(deps.reconcileGoods).not.toHaveBeenCalled();
  });

  it('종결된 attempt에 대한 웹훅(중복 수신·상태 역전 신호)은 no-op 200이다', async () => {
    for (const state of ['approved', 'declined', 'canceled']) {
      const { deps, post } = handler({
        loadAttempt: vi.fn(async () => ({
          id: ATTEMPT_ID,
          purpose: 'order' as const,
          state,
        })),
      });
      const result = await post(webhookRequest(statusChangedBody()));
      expect(result.status).toBe(200);
      expect(deps.reconcileGoods).not.toHaveBeenCalled();
    }
  });

  it('prepared attempt는 TTL 스윕 소관이라 재정합을 태우지 않는다', async () => {
    const { deps, post } = handler({
      loadAttempt: vi.fn(async () => ({
        id: ATTEMPT_ID,
        purpose: 'order' as const,
        state: 'prepared',
      })),
    });

    const result = await post(webhookRequest(statusChangedBody()));

    expect(result.status).toBe(200);
    expect(deps.reconcileGoods).not.toHaveBeenCalled();
  });

  it('미지 paymentKey/orderId는 200 ack로 닫는다 — 재전송해도 처리할 것이 없다', async () => {
    const { deps, post } = handler({ loadAttempt: vi.fn(async () => null) });

    const result = await post(webhookRequest(statusChangedBody()));

    expect(result.status).toBe(200);
    expect(deps.reconcileGoods).not.toHaveBeenCalled();
    expect(deps.reconcileTicket).not.toHaveBeenCalled();
  });

  it('형식이 유효해도 우리 주문번호 체계 밖의 orderId는 200 ack다', async () => {
    const { deps, post } = handler();

    const result = await post(webhookRequest(statusChangedBody({ orderId: 'a4CWyWY5m89PNh7xJwhk1' })));

    expect(result.status).toBe(200);
    expect(deps.loadAttempt).not.toHaveBeenCalled();
  });

  it('비지원 이벤트 타입은 조회 없이 200 ack다', async () => {
    const { deps, post } = handler();

    const result = await post(webhookRequest({
      eventType: 'DEPOSIT_CALLBACK',
      createdAt: '2026-09-01T00:00:00.000000',
      secret: 'virtual-account-secret',
      orderId: PROVIDER_ORDER_ID,
    }));

    expect(result.status).toBe(200);
    expect(deps.loadAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON 아님', () => webhookRequest(null, {}, 'not-json{{')],
    ['eventType 없음', () => webhookRequest({ createdAt: 'x', data: {} })],
    ['content-type 위반', () => new Request('https://icons.example/api/webhooks/tosspayments', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(statusChangedBody()),
    })],
    ['과대 본문 선언', () => webhookRequest(statusChangedBody(), { 'content-length': '65537' })],
  ])('형식 위반은 400으로 관측 가능하게 남긴다: %s', async (_label, makeRequest) => {
    const { deps, post } = handler();
    const result = await post(makeRequest());
    expect(result.status).toBe(400);
    expect(deps.loadAttempt).not.toHaveBeenCalled();
  });

  it('runtime이 닫혀 있으면 503으로 재전송을 유도한다', async () => {
    const { deps, post } = handler({ available: () => false });
    const result = await post(webhookRequest(statusChangedBody()));
    expect(result.status).toBe(503);
    expect(deps.loadAttempt).not.toHaveBeenCalled();
  });

  it('다른 재정합이 진행 중이면 재전송 소음 없이 200으로 닫는다', async () => {
    const { post } = handler({
      reconcileGoods: vi.fn(async () => {
        throw new GoodsPaymentReconciliationInProgressError();
      }),
    });
    const result = await post(webhookRequest(
      statusChangedBody(),
      { 'tosspayments-webhook-transmission-id': TRANSMISSION_ID },
    ));
    expect(result.status).toBe(200);
  });

  it('재정합 실패는 500으로 남겨 재전송이 다시 시도하게 한다', async () => {
    const { post } = handler({
      reconcileGoods: vi.fn(async () => {
        throw new Error(`private detail ${PAYMENT_KEY}`);
      }),
    });
    const result = await post(webhookRequest(statusChangedBody()));
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain(PAYMENT_KEY);
  });

  it('전송 id 헤더가 없으면 무작위 case ref로 감사를 남긴다', async () => {
    const { deps, post } = handler();

    await post(webhookRequest(statusChangedBody()));

    expect(deps.reconcileGoods).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      caseRef: 'webhook-11111111-2222-4333-8444-555555555555',
    });
  });
});
