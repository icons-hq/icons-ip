import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt, PaymentBalanceInspection } from './gateway';
import {
  GoodsProviderCancellationCheckError,
  createGoodsProviderCancellationCheck,
  createGoodsProviderCancellationRepository,
} from './goods-provider-cancellation.server';

const ATTEMPT_ID = '30000000-0000-4000-8000-000000000651';
const ORDER_ID = '20000000-0000-4000-8000-000000000651';
const CASE_REF = 'whtrans_provider_cancel_0651';
const attempt: PaymentAttempt = {
  id: ATTEMPT_ID, provider: 'toss', purpose: 'order', refId: ORDER_ID, amount: 31_000, currency: 'KRW',
  idempotencyKey: `goods:${ORDER_ID}`, providerOrderId: 'O30000000000040008000000000000651',
  providerProductCode: 'P30000000000040008000000000000651', expiresAt: '2099-08-13T10:10:00.000Z',
};

function check(inspection: PaymentBalanceInspection | Error, verdict: string = 'held', context: unknown = { attempt, paymentKey: 'ledger-payment-key' }) {
  const deps = {
    loadContext: vi.fn(async () => context as never),
    inspect: vi.fn(async () => { if (inspection instanceof Error) throw inspection; return inspection; }),
    record: vi.fn(async () => verdict as never),
  };
  return { deps, run: () => createGoodsProviderCancellationCheck(deps)({ attemptId: ATTEMPT_ID, caseRef: CASE_REF }) };
}

describe('결제사 직접 취소 감지', () => {
  it('원장 결제 키로 조회한 잔액과 상태를 DB 대조에 넘긴다(웹훅 본문은 쓰지 않는다)', async () => {
    const { deps, run } = check({ kind: 'ok', status: 'PARTIAL_CANCELED', balanceAmount: 21_000, lastCancel: { cancelAmount: 10_000, transactionKey: 'tx-1' } });
    await expect(run()).resolves.toBe('held');
    expect(deps.inspect).toHaveBeenCalledWith(attempt, 'ledger-payment-key');
    expect(deps.record).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, providerStatus: 'PARTIAL_CANCELED', providerBalance: 21_000, caseRef: CASE_REF });
  });

  it('대상이 아니면(취소 주문·환불 결제·티켓) 조회하지 않는다', async () => {
    const { deps, run } = check({ kind: 'ok', status: 'CANCELED', balanceAmount: 0, lastCancel: null }, 'held', null);
    await expect(run()).resolves.toBe('not_applicable');
    expect(deps.inspect).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it('조회 일시 실패·DB 실패는 throw해 웹훅 재전송을 받는다', async () => {
    await expect(check({ kind: 'unavailable' }).run()).rejects.toBeInstanceOf(GoodsProviderCancellationCheckError);
    await expect(check(new Error('network')).run()).rejects.toMatchObject({ code: 'provider_unavailable' });
    const failingRecord = check({ kind: 'ok', status: 'CANCELED', balanceAmount: 0, lastCancel: null });
    failingRecord.deps.record.mockRejectedValueOnce(new Error('db'));
    await expect(failingRecord.run()).rejects.toMatchObject({ code: 'record_failed' });
    const failingContext = check({ kind: 'ok', status: 'CANCELED', balanceAmount: 0, lastCancel: null });
    failingContext.deps.loadContext.mockRejectedValueOnce(new Error('db'));
    await expect(failingContext.run()).rejects.toMatchObject({ code: 'context_failed' });
    await expect(check({ kind: 'ok', status: 'CANCELED', balanceAmount: 0, lastCancel: null }, 'surprise').run())
      .rejects.toMatchObject({ code: 'record_failed' });
  });

  it('응답이 이 결제와 맞지 않으면 판정 근거로 쓰지 않고, 정기배송 결제는 대상이 아니다', async () => {
    const mismatch = check({ kind: 'mismatch' });
    await expect(mismatch.run()).resolves.toBe('mismatch');
    expect(mismatch.deps.record).not.toHaveBeenCalled();
    await expect(check({ kind: 'ok', status: 'canceled', balanceAmount: 0, lastCancel: null }).run()).resolves.toBe('mismatch');
    await expect(check({ kind: 'not_supported' }).run()).resolves.toBe('not_applicable');
  });

  it('in_flight 판정은 그대로 돌려준다(라우트가 503으로 미룬다)', async () => {
    await expect(check({ kind: 'ok', status: 'CANCELED', balanceAmount: 0, lastCancel: null }, 'in_flight').run()).resolves.toBe('in_flight');
  });
});

describe('결제사 직접 취소 감지 저장소', () => {
  it('service RPC 계약: 대상 읽기와 대조 기록', async () => {
    const rpc = vi.fn(async (name: string) => name === 'service_goods_provider_cancellation_context'
      ? { data: { attempt: { id: ATTEMPT_ID, provider: 'toss', purpose: 'order', ref_id: ORDER_ID, amount: 31_000, currency: 'KRW',
          idempotency_key: attempt.idempotencyKey, provider_order_id: attempt.providerOrderId, provider_product_code: attempt.providerProductCode,
          expires_at: attempt.expiresAt }, paymentKey: 'ledger-payment-key' }, error: null }
      : { data: 'already_recorded', error: null });
    const repository = createGoodsProviderCancellationRepository({ rpc });

    await expect(repository.loadContext(ATTEMPT_ID)).resolves.toEqual({ attempt, paymentKey: 'ledger-payment-key' });
    await expect(repository.record({ attemptId: ATTEMPT_ID, providerStatus: 'CANCELED', providerBalance: 0, caseRef: CASE_REF }))
      .resolves.toBe('already_recorded');
    expect(rpc).toHaveBeenLastCalledWith('service_flag_goods_provider_cancellation',
      { p_attempt_id: ATTEMPT_ID, p_provider_status: 'CANCELED', p_provider_balance: 0, p_case_ref: CASE_REF });
  });

  it('대상이 아니면 null, 형태가 어긋나거나 오류면 throw', async () => {
    await expect(createGoodsProviderCancellationRepository({ rpc: async () => ({ data: null, error: null }) }).loadContext(ATTEMPT_ID)).resolves.toBeNull();
    await expect(createGoodsProviderCancellationRepository({ rpc: async () => ({ data: { attempt: { id: ATTEMPT_ID } }, error: null }) }).loadContext(ATTEMPT_ID)).rejects.toThrow();
    await expect(createGoodsProviderCancellationRepository({ rpc: async () => ({ data: null, error: { message: 'x' } }) }).loadContext(ATTEMPT_ID)).rejects.toThrow();
  });
});
