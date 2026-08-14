import { describe, expect, it, vi } from 'vitest';
import {
  GoodsManualRecoveryContractError,
  recoverGoodsPaymentManually,
  type GoodsManualRecoveryRepository,
} from './goods-manual-recovery.server';

const ATTEMPT_ID = '30000000-0000-4000-8000-000000002081';
const REQUEST_ID = '60000000-0000-4000-8000-000000002081';
const ACTOR_ID = '00000000-0000-4000-8000-000000002081';

function repository(
  overrides: Partial<GoodsManualRecoveryRepository> = {},
): GoodsManualRecoveryRepository {
  return {
    claim: vi.fn(async () => ({ status: 'claimed' as const })),
    finalize: vi.fn(async () => 'provider_cancel_confirmed' as const),
    ...overrides,
  };
}

describe('recoverGoodsPaymentManually', () => {
  it('provider 전액 취소 확인은 operator attestation과 opaque case만 사용한다', async () => {
    const target = repository({
      finalize: vi.fn(async () => 'provider_cancel_confirmed' as const),
    });

    await expect(recoverGoodsPaymentManually({
      operation: 'provider_cancel_confirmed',
      attemptId: ATTEMPT_ID,
      actorId: ACTOR_ID,
      requestId: REQUEST_ID,
      operatorAttested: true,
    }, target)).resolves.toEqual({ outcome: 'provider_cancel_confirmed' });

    expect(target.finalize).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'provider_cancel_confirmed',
      requestId: REQUEST_ID,
      caseRef: expect.stringMatching(/^case_v1_[0-9a-f]{32}$/),
      operatorAttested: true,
    }));
  });

  it('active claim은 provider 또는 finalizer를 중복 실행하지 않고 처리 중으로 반환한다', async () => {
    const target = repository({
      claim: vi.fn(async () => ({ status: 'in_progress' as const })),
    });

    await expect(recoverGoodsPaymentManually({
      operation: 'provider_cancel_confirmed',
      attemptId: ATTEMPT_ID,
      actorId: ACTOR_ID,
      requestId: REQUEST_ID,
      operatorAttested: true,
    }, target)).resolves.toEqual({ outcome: 'in_progress' });

    expect(target.finalize).not.toHaveBeenCalled();
  });

  it('attempt+operation 종결 replay는 새 server case여도 finalizer를 다시 실행하지 않는다', async () => {
    const target = repository({
      claim: vi.fn(async () => ({
        status: 'terminal' as const,
        outcome: 'provider_cancel_confirmed' as const,
      })),
    });

    await expect(recoverGoodsPaymentManually({
      operation: 'provider_cancel_confirmed',
      attemptId: ATTEMPT_ID,
      actorId: ACTOR_ID,
      requestId: REQUEST_ID,
      operatorAttested: true,
    }, target)).resolves.toEqual({ outcome: 'provider_cancel_confirmed' });

    expect(target.finalize).not.toHaveBeenCalled();
  });

  it.each([
    ['caller case ref', { caseRef: 'case_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['missing attestation', { operatorAttested: false }],
    ['raw payment key', { providerPaymentKey: 'raw-provider-secret' }],
    ['raw TID', { tid: 'raw-provider-tid' }],
    ['raw PAN', { cardNumber: '4111111111111111' }],
  ])('%s는 repository 전에 fail closed한다', async (_label, extra) => {
    const target = repository();
    const input = {
      operation: 'provider_cancel_confirmed',
      attemptId: ATTEMPT_ID,
      actorId: ACTOR_ID,
      requestId: REQUEST_ID,
      operatorAttested: true,
      ...extra,
    };

    await expect(recoverGoodsPaymentManually(
      input as never,
      target,
    )).rejects.toBeInstanceOf(GoodsManualRecoveryContractError);
    expect(target.claim).not.toHaveBeenCalled();
    expect(target.finalize).not.toHaveBeenCalled();
  });
});
