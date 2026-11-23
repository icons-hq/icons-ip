import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome, PaymentAttempt } from './gateway';
import { createRuntimeGoodsPaymentCheckout } from './goods-checkout.runtime.server';

/* Composition root 배선 검증 — deep module은 진짜를 쓰고 경계만 대체한다.
 * 여기서 확인하려는 것은 checkout 로직이 아니라 "승인 확정이 주문 확인 메일
 * 훅(#239·D8)까지 실제로 이어지는가"와 provider 인자가 게이트웨이 선택까지
 * 흐르는가다. 기본 provider는 toss(에픽 #384), korpay는 콜백 drain용 명시 인자. */

const ORDER_ID = '20000000-0000-4000-8000-000000000207';
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000207';

const mocks = vi.hoisted(() => ({
  getPaymentGateway: vi.fn(),
  tossGatewayKeyMode: vi.fn(),
  recordKeyMode: vi.fn(),
  sendOrderConfirmationEmail: vi.fn(),
  sendVirtualAccountIssuedEmail: vi.fn(),
  after: vi.fn(),
  repository: {
    prepareOrderAttempt: vi.fn(),
    bindCallbackNonce: vi.fn(),
    claimOrderAttempt: vi.fn(),
    finalizeOrderAttempt: vi.fn(),
    claimOrderReconciliation: vi.fn(),
    finalizeOrderReconciliation: vi.fn(),
  },
}));

vi.mock('../supabase/service', () => ({
  createServiceClient: () => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }),
}));
vi.mock('./runtime-gateway', () => ({
  getPaymentGateway: mocks.getPaymentGateway,
  tossGatewayKeyMode: mocks.tossGatewayKeyMode,
}));
vi.mock('./goods-checkout.server', () => ({
  createGoodsPaymentAttemptRepository: () => mocks.repository,
  createGoodsPaymentKeyModeRecorder: () => mocks.recordKeyMode,
}));
vi.mock('../email/transactional.server', () => ({
  sendOrderConfirmationEmail: mocks.sendOrderConfirmationEmail,
  sendVirtualAccountIssuedEmail: mocks.sendVirtualAccountIssuedEmail,
}));
vi.mock('next/server', () => ({ after: mocks.after }));

function attemptFor(provider: 'toss' | 'korpay'): PaymentAttempt {
  return {
    id: ATTEMPT_ID,
    provider,
    purpose: 'order',
    refId: ORDER_ID,
    amount: 31_000,
    currency: 'KRW',
    idempotencyKey: `goods:${ORDER_ID}`,
    providerOrderId: 'O30000000000040008000000000000207',
    providerProductCode: 'P30000000000040008000000000000207',
    expiresAt: '2099-08-13T10:10:00.000Z',
  };
}

function outcomeFor(
  provider: 'toss' | 'korpay',
  value: ConfirmOutcome['outcome'],
): ConfirmOutcome {
  return { attemptId: ATTEMPT_ID, provider, outcome: value };
}

function stubConfirmedPayment(provider: 'toss' | 'korpay', value: ConfirmOutcome['outcome']) {
  mocks.getPaymentGateway.mockReturnValue({
    confirm: vi.fn().mockResolvedValue(outcomeFor(provider, value)),
  });
  mocks.repository.claimOrderAttempt.mockResolvedValue({
    status: 'claimed',
    attempt: attemptFor(provider),
    claimToken: '50000000-0000-4000-8000-000000000207',
  });
  mocks.repository.finalizeOrderAttempt.mockImplementation(
    async (input: { outcome: ConfirmOutcome }) => input.outcome,
  );
}

const callback = {
  providerOrderId: 'O30000000000040008000000000000207',
  callbackNonce: 'opaque-callback-nonce-207',
  providerPayload: { resultCode: '0000' },
} as const;

describe('createRuntimeGoodsPaymentCheckout', () => {
  beforeEach(() => {
    mocks.getPaymentGateway.mockReset();
    mocks.tossGatewayKeyMode.mockReset();
    mocks.tossGatewayKeyMode.mockReturnValue(null);
    mocks.recordKeyMode.mockReset();
    mocks.recordKeyMode.mockResolvedValue(undefined);
    mocks.sendOrderConfirmationEmail.mockReset();
    mocks.sendOrderConfirmationEmail.mockResolvedValue({ status: 'sent' });
    mocks.sendVirtualAccountIssuedEmail.mockReset();
    mocks.sendVirtualAccountIssuedEmail.mockResolvedValue({ status: 'sent' });
    /* 기본은 요청 범위 밖 — after()가 던지면 직접 기다린다. */
    mocks.after.mockReset();
    mocks.after.mockImplementation(() => { throw new Error('outside request scope'); });
    for (const fn of Object.values(mocks.repository)) fn.mockReset();
  });

  it('기본 provider는 toss이고 승인 확정은 주문 확인 메일 훅을 주문 id로 부른다', async () => {
    stubConfirmedPayment('toss', 'approved');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'approved' });

    expect(mocks.getPaymentGateway).toHaveBeenCalledWith('toss');
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('입금 대기 확정은 입금 안내 메일 훅만 주문 id로 부른다', async () => {
    stubConfirmedPayment('toss', 'awaiting_deposit');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'awaiting_deposit' });

    expect(mocks.sendVirtualAccountIssuedEmail).toHaveBeenCalledWith(ORDER_ID);
    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  it('요청 범위 안이면 메일을 after()로 미뤄 승인 응답이 메일을 기다리지 않는다', async () => {
    const queued: (() => Promise<void>)[] = [];
    mocks.after.mockImplementation((task: () => Promise<void>) => { queued.push(task); });
    stubConfirmedPayment('toss', 'approved');

    await createRuntimeGoodsPaymentCheckout().confirm(callback);

    expect(queued).toHaveLength(1);
    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled();
    await queued[0]();
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('korpay를 명시하면 drain 조립도 같은 메일 훅으로 종결된다', async () => {
    stubConfirmedPayment('korpay', 'approved');

    await expect(createRuntimeGoodsPaymentCheckout('korpay').confirm(callback))
      .resolves.toMatchObject({ outcome: 'approved' });

    expect(mocks.getPaymentGateway).toHaveBeenCalledWith('korpay');
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('승인이 아닌 종결은 메일 훅에 닿지 않는다', async () => {
    stubConfirmedPayment('toss', 'declined');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'declined' });

    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  /*
   * 굿즈 웹훅의 paymentKey 힌트가 attempt 래퍼(billing binding 판정)를 지나 토스 게이트웨이까지
   * 그대로 가는지 — 래퍼가 두 번째 인자를 버리면 굿즈 웹훅은 orderId 조회로만 판정된다.
   */
  it.each([['webhook-payment-key-hint'], [undefined]])(
    '굿즈 웹훅 힌트(%s)는 attempt 래퍼를 지나 toss reconcile의 두 번째 인자로만 전달된다',
    async (hint) => {
      const attempt = attemptFor('toss');
      const reconcile = vi.fn().mockResolvedValue(outcomeFor('toss', 'declined'));
      mocks.getPaymentGateway.mockReturnValue({ reconcile });
      mocks.repository.claimOrderReconciliation.mockResolvedValue({
        status: 'claimed',
        attempt,
        claimToken: '50000000-0000-4000-8000-000000000208',
      });
      mocks.repository.finalizeOrderReconciliation.mockImplementation(
        async (input: { outcome: ConfirmOutcome }) => input.outcome,
      );

      await expect(createRuntimeGoodsPaymentCheckout('toss').reconcilePayment({
        attemptId: ATTEMPT_ID,
        caseRef: 'case_goods_opaque_0208',
        ...(hint ? { providerPaymentKeyHint: hint } : {}),
      })).resolves.toMatchObject({ outcome: 'declined' });

      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(reconcile.mock.calls[0]).toEqual(hint ? [attempt, { providerPaymentKey: hint }] : [attempt]);
    },
  );

  /* 운영 배포의 토스 테스트 키 결제는 준비 때 키 모드를 남겨 DB가 승인 뒤 출고 보류한다. 코페이·나이스페이는 남기지 않는다. */
  it.each([['toss', 'test', 1], ['toss', null, 0], ['korpay', 'test', 0]] as const)(
    '%s 결제 준비는 게이트웨이 키 모드(%s)를 시도에 남긴다(호출 %i회)',
    async (provider, keyMode, calls) => {
      mocks.tossGatewayKeyMode.mockReturnValue(keyMode);
      const attempt = attemptFor(provider);
      mocks.repository.prepareOrderAttempt.mockResolvedValue(attempt);
      mocks.repository.bindCallbackNonce.mockResolvedValue(undefined);
      mocks.getPaymentGateway.mockReturnValue({
        prepare: vi.fn().mockResolvedValue({
          attemptId: attempt.id, provider, action: { kind: 'redirect', url: 'https://payments.example.test' },
          callbackNonce: 'opaque-callback-nonce-key-mode', expiresAt: attempt.expiresAt,
        }),
      });

      await createRuntimeGoodsPaymentCheckout(provider).prepare({ userId: '10000000-0000-4000-8000-000000000207', orderId: ORDER_ID });

      expect(mocks.recordKeyMode).toHaveBeenCalledTimes(calls);
      if (calls) expect(mocks.recordKeyMode).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, keyMode });
    },
  );
});
