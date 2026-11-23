import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome, PaymentAttempt } from './gateway';
import { createGoodsPaymentAttemptRepository } from './goods-checkout.server';

const ATTEMPT_ID = '30000000-0000-4000-8000-000000000205';
const ORDER_ID = '20000000-0000-4000-8000-000000000205';

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    provider: 'korpay',
    purpose: 'order',
    ref_id: ORDER_ID,
    amount: 31000,
    currency: 'KRW',
    idempotency_key: `goods:${ORDER_ID}`,
    provider_order_id: 'O30000000000040008000000000000205',
    provider_product_code: 'P30000000000040008000000000000205',
    expires_at: '2099-08-13T10:10:00.000Z',
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

describe('GoodsPaymentAttemptRepository', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('DB attempt row를 PaymentAttempt 공개 계약으로만 매핑한다', async () => {
    mocks.rpc.mockResolvedValue({ data: attemptRow(), error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.prepareOrderAttempt({
      userId: '00000000-0000-4000-8000-000000000205',
      orderId: ORDER_ID,
      provider: 'korpay',
    })).resolves.toEqual({
      id: ATTEMPT_ID,
      provider: 'korpay',
      purpose: 'order',
      refId: ORDER_ID,
      amount: 31000,
      currency: 'KRW',
      idempotencyKey: `goods:${ORDER_ID}`,
      providerOrderId: 'O30000000000040008000000000000205',
      providerProductCode: 'P30000000000040008000000000000205',
      expiresAt: '2099-08-13T10:10:00.000Z',
    } satisfies PaymentAttempt);
    expect(mocks.rpc).toHaveBeenCalledWith('prepare_goods_payment_attempt', {
      p_user_id: '00000000-0000-4000-8000-000000000205',
      p_order_id: ORDER_ID,
      p_provider: 'korpay',
    });
  });

  it('terminal claim의 DB state를 common outcome으로 replay한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: { claim_status: 'terminal', attempt: attemptRow(), outcome: 'declined' },
      error: null,
    });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.claimOrderAttempt({
      provider: 'korpay',
      providerOrderId: 'O30000000000040008000000000000205',
      callbackNonceDigest: 'a'.repeat(64),
      claimToken: '40000000-0000-4000-8000-000000000205',
    })).resolves.toEqual({
      status: 'terminal',
      attempt: expect.objectContaining({ id: ATTEMPT_ID }),
      outcome: {
        attemptId: ATTEMPT_ID,
        provider: 'korpay',
        outcome: 'declined',
      },
    });
  });

  it('finalize에는 allowlist evidence만 보내고 provider raw를 저장하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'approved', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });
    const outcome: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
      reasonCode: 'fake_approved',
      evidence: {
        providerTransactionId: 'txn-205',
        maskedPaymentMethod: '1234-****-****-5678',
        approvedAt: '2025-12-11T06:11:01.000Z',
        resultCode: '3001',
      },
    };

    await expect(repository.finalizeOrderAttempt({
      attemptId: ATTEMPT_ID,
      claimToken: '40000000-0000-4000-8000-000000000205',
      outcome,
    })).resolves.toEqual(outcome);
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_goods_payment_attempt', expect.objectContaining({
      p_attempt_id: ATTEMPT_ID,
      p_provider_transaction_id: 'txn-205',
      p_masked_payment_method: '1234-****-****-5678',
      p_approved_at: '2025-12-11T06:11:01.000Z',
      p_result_code: '3001',
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('providerPayload');
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('fake_approved');
  });

  it('DB finalizer가 승인 대신 review로 내리면 그 fail-closed 결과를 반환한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'needs_review', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.finalizeOrderAttempt({
      attemptId: ATTEMPT_ID,
      claimToken: '40000000-0000-4000-8000-000000000205',
      outcome: {
        attemptId: ATTEMPT_ID,
        provider: 'korpay',
        outcome: 'approved',
      },
    })).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'database_finalization_guard',
    });
  });

  it('판매기간 거부만 공개 가능한 도메인 코드로 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'goods_sale_not_open' } });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });
    await expect(repository.prepareOrderAttempt({ userId: '00000000-0000-4000-8000-000000000205', orderId: ORDER_ID, provider: 'toss' })).rejects.toMatchObject({ code: 'goods_sale_not_open' });
  });

  it('DB 오류는 원문을 공개하지 않는 repository error로 감싼다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.bindCallbackNonce({
      attemptId: ATTEMPT_ID,
      callbackNonceDigest: 'b'.repeat(64),
    })).rejects.toThrow('goods_payment_repository_failed');
  });
});

describe('GoodsPaymentAttemptRepository — 가상계좌 입금 대기(ADR-0049)', () => {
  beforeEach(() => mocks.rpc.mockReset());

  const awaiting: ConfirmOutcome = {
    attemptId: ATTEMPT_ID,
    provider: 'toss',
    outcome: 'awaiting_deposit',
    reasonCode: 'provider_awaiting_deposit',
    evidence: {
      providerPaymentKey: 'va-payment-key',
      resultCode: 'WAITING_FOR_DEPOSIT',
      paymentMethod: '가상계좌',
      virtualAccount: {
        bankCode: '20',
        accountNumber: 'X6505636518308',
        dueAt: '2026-11-24T03:00:00.000Z',
        useEscrow: true,
        refundReceiveAccount: { bankCode: '88', accountNumber: '110123456789', holderName: '김토스' },
      },
    },
  };

  it('입금 대기는 전용 finalizer에 계좌·기한·에스크로·환불 계좌를 넘긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'awaiting_deposit', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.finalizeOrderAttempt({ attemptId: ATTEMPT_ID, claimToken: 'claim', outcome: awaiting }))
      .resolves.toEqual(awaiting);
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_goods_payment_awaiting_deposit', {
      p_attempt_id: ATTEMPT_ID,
      p_claim_token: 'claim',
      p_provider_payment_key: 'va-payment-key',
      p_bank_code: '20',
      p_account_number: 'X6505636518308',
      p_due_at: '2026-11-24T03:00:00.000Z',
      p_use_escrow: true,
      p_refund_bank_code: '88',
      p_refund_account_number: '110123456789',
      p_refund_holder_name: '김토스',
    });
  });

  it('DB가 거부해 needs_review를 돌려주면 database_finalization_guard로 그 결과를 따른다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'needs_review', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.finalizeOrderAttempt({ attemptId: ATTEMPT_ID, claimToken: 'claim', outcome: awaiting }))
      .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'database_finalization_guard' });
  });

  it('재정합의 입금 대기는 감사 행을 닫는 재정합 전용 finalizer를 쓴다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'awaiting_deposit', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await repository.finalizeOrderReconciliation({ attemptId: ATTEMPT_ID, claimToken: 'claim', outcome: awaiting });

    expect(mocks.rpc).toHaveBeenCalledWith('finalize_goods_payment_reconciliation_awaiting_deposit', expect.objectContaining({
      p_attempt_id: ATTEMPT_ID,
      p_bank_code: '20',
    }));
  });

  it('계좌가 실리지 않은 입금 대기는 계약 위반이라 일반 finalizer에 needs_review로 넘긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'needs_review', error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await repository.finalizeOrderAttempt({
      attemptId: ATTEMPT_ID,
      claimToken: 'claim',
      outcome: { ...awaiting, evidence: { providerPaymentKey: 'va-payment-key' } },
    });

    expect(mocks.rpc).toHaveBeenCalledWith('finalize_goods_payment_attempt', expect.objectContaining({ p_outcome: 'needs_review' }));
  });

  it('입금 대기 terminal claim(중복 successUrl)을 그대로 재생한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { claim_status: 'terminal', attempt: attemptRow({ provider: 'toss' }), outcome: 'awaiting_deposit' }, error: null });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    const claim = await repository.claimOrderAttempt({
      provider: 'toss', providerOrderId: 'O30000000000040008000000000000205', callbackNonceDigest: 'd', claimToken: 'c',
    });

    expect(claim).toMatchObject({ status: 'terminal', outcome: { outcome: 'awaiting_deposit' } });
  });
});
