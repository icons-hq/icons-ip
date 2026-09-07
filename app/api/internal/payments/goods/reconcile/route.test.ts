import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoodsPaymentContractError,
  GoodsPaymentReconciliationInProgressError,
} from '@/lib/payments/goods-checkout';
import { POST } from './route';

const SECRET = 'goods-reconciliation-secret';
const attemptId = '30000000-0000-4000-8000-000000000410';
const PAYMENT_KEY = 'tviva20260901000000goodsKEY123456';
const mocks = vi.hoisted(() => ({
  available: true,
  availabilityProvider: undefined as string | undefined,
  checkoutProvider: undefined as string | undefined,
  reconcile: vi.fn(),
}));

vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsPaymentConfirmationAvailable: (provider?: string) => {
    mocks.availabilityProvider = provider;
    return mocks.available;
  },
  goodsCheckoutPaymentsEnabled: () => false,
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: (provider?: string) => {
    mocks.checkoutProvider = provider;
    return { reconcilePayment: mocks.reconcile };
  },
}));

function request(
  secret = SECRET,
  body: unknown = {
    operation: 'payment',
    attemptId,
    caseRef: 'case_goods_opaque_410',
  },
  rawBody?: string,
) {
  return new Request('https://icons.local/api/internal/payments/goods/reconcile', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

describe('POST /api/internal/payments/goods/reconcile', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', 'retired-shared-cron-secret');
    mocks.available = true;
    mocks.availabilityProvider = undefined;
    mocks.checkoutProvider = undefined;
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue({
      attemptId,
      provider: 'toss',
      outcome: 'approved',
      reasonCode: 'provider_reconciled_approved',
      evidence: { providerPaymentKey: PAYMENT_KEY, resultCode: 'DONE' },
    });
  });

  it('전용 secret과 opaque caseRef로 지정 건 하나를 toss 조립으로 재정합하고 provider 식별자는 응답에 싣지 않는다', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ attemptId, outcome: 'approved' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      attemptId,
      caseRef: 'case_goods_opaque_410',
    });
    expect(mocks.availabilityProvider).toBe('toss');
    expect(mocks.checkoutProvider).toBe('toss');
  });

  it('secret 불일치·legacy CRON secret은 401로 닫고 domain을 부르지 않는다', async () => {
    expect((await POST(request('wrong-secret'))).status).toBe(401);
    expect((await POST(request('retired-shared-cron-secret'))).status).toBe(401);
    expect((await POST(new Request('https://icons.local/api/internal/payments/goods/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'payment', attemptId, caseRef: 'case_goods_opaque_410' }),
    }))).status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('미설정 또는 형식 불량 secret은 exact bearer여도 fail closed한다', async () => {
    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', 'too-short');
    expect((await POST(request('too-short'))).status).toBe(401);

    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', 'invalid-secret-with-$ymbol');
    expect((await POST(request('invalid-secret-with-$ymbol'))).status).toBe(401);

    vi.stubEnv('PAYMENT_RECONCILIATION_SECRET', '');
    expect((await POST(request(''))).status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('토스 자격 증명·service가 닫혀 있으면 503이고 domain을 부르지 않는다', async () => {
    mocks.available = false;
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'payment_unavailable' });
    expect(mocks.availabilityProvider).toBe('toss');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ['refund operation(굿즈에는 환불 reconcile seam이 없다)', { operation: 'refund', requestId: attemptId, caseRef: 'case_goods_opaque_410' }],
    ['operation 누락', { attemptId, caseRef: 'case_goods_opaque_410' }],
    ['attemptId 형식 위반', { operation: 'payment', attemptId: 'not-a-uuid', caseRef: 'case_goods_opaque_410' }],
    ['caseRef에 PII성 문자', { operation: 'payment', attemptId, caseRef: 'staff@example.test' }],
    ['caseRef 과단', { operation: 'payment', attemptId, caseRef: 'short' }],
    ['배열 본문', [attemptId]],
  ])('본문 검증 실패는 provider 호출 전에 400으로 거부한다: %s', async (_label, body) => {
    const response = await POST(request(SECRET, body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('JSON이 아닌 본문은 400이다', async () => {
    const response = await POST(request(SECRET, undefined, '{not json'));
    expect(response.status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('unknown·needs_review는 202로 돌려 종결로 가장하지 않는다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ attemptId, provider: 'toss', outcome: 'unknown' });
    const unknown = await POST(request());
    expect(unknown.status).toBe(202);
    await expect(unknown.json()).resolves.toEqual({ attemptId, outcome: 'unknown' });

    mocks.reconcile.mockResolvedValueOnce({
      attemptId,
      provider: 'toss',
      outcome: 'needs_review',
      reasonCode: 'provider_configuration_error',
      evidence: { resultCode: 'UNAUTHORIZED_KEY' },
    });
    const needsReview = await POST(request());
    expect(needsReview.status).toBe(202);
    await expect(needsReview.json()).resolves.toEqual({ attemptId, outcome: 'needs_review' });
  });

  it.each([
    ['declined', 200],
    ['canceled', 200],
  ] as const)('%s 종결은 200이다', async (outcome, status) => {
    mocks.reconcile.mockResolvedValueOnce({ attemptId, provider: 'toss', outcome });
    const response = await POST(request());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ attemptId, outcome });
  });

  it('다른 처리자가 claim 리스를 쥔 재정합 진행 중은 202 unknown이다', async () => {
    mocks.reconcile.mockRejectedValueOnce(new GoodsPaymentReconciliationInProgressError());
    const response = await POST(request());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ outcome: 'unknown' });
  });

  it('계약 오류는 400, 그 밖의 예외는 502이며 내부 메시지를 노출하지 않는다', async () => {
    mocks.reconcile.mockRejectedValueOnce(new GoodsPaymentContractError('goods_payment_not_reconcilable'));
    const contract = await POST(request());
    expect(contract.status).toBe(400);
    expect(await contract.text()).not.toContain('goods_payment_not_reconcilable');

    mocks.reconcile.mockRejectedValueOnce(new Error('private provider secret'));
    const failure = await POST(request());
    expect(failure.status).toBe(502);
    await expect(failure.json()).resolves.toEqual({ error: 'reconciliation_failed' });
    expect(failure.headers.get('cache-control')).toBe('no-store');
  });
});
