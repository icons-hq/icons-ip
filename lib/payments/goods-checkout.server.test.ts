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

  it('DB 오류는 원문을 공개하지 않는 repository error로 감싼다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const repository = createGoodsPaymentAttemptRepository({ rpc: mocks.rpc });

    await expect(repository.bindCallbackNonce({
      attemptId: ATTEMPT_ID,
      callbackNonceDigest: 'b'.repeat(64),
    })).rejects.toThrow('goods_payment_repository_failed');
  });
});
