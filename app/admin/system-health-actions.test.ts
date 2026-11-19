import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), reconcile: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/payments/attempt-reconciliation.server', () => ({ reconcilePaymentAttempt: mocks.reconcile }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { reconcilePaymentAttemptAction } from './system-health-actions';

const attemptId = 'a7000000-0000-4003-8000-000000000001';
const operationId = 'a7000000-0000-4009-8000-000000000001';
const begun = { attemptId, purpose: 'order', provider: 'toss', state: 'unknown', refId: 'a7000000-0000-4002-8000-000000000001', caseRef: 'admin-a7000000000040098000000000000001' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'operator-1' } });
  mocks.rpc.mockResolvedValue({ data: begun, error: null });
  mocks.reconcile.mockResolvedValue({ kind: 'reconciled', outcome: 'declined' });
});

describe('결제 상태 다시 확인', () => {
  it('주문 관리 권한이 없으면 감사 기록도 결제사 조회도 하지 않는다', async () => {
    mocks.guard.mockResolvedValue(null);
    expect(await reconcilePaymentAttemptAction({ attemptId, operationId })).toEqual({ ok: false, error: '결제 상태를 다시 확인할 권한이 없습니다.' });
    expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/system', { capability: 'sales.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('감사 기록을 먼저 남기고 DB가 돌려준 caseRef로 서버 안의 재정합 seam을 부른다', async () => {
    const result = await reconcilePaymentAttemptAction({ attemptId, operationId });
    expect(result).toEqual({ ok: true, outcome: 'declined', message: expect.stringContaining('재고·쿠폰이 풀립니다') });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_begin_payment_reconciliation', { p_attempt_id: attemptId, p_operation_id: operationId });
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(
      { attemptId, purpose: 'order', provider: 'toss', refId: begun.refId, caseRef: begun.caseRef }, begun.caseRef);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcile.mock.invocationCallOrder[0]);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/settings/system');
  });

  it('DB가 거절하면(쿨다운·종결·권한) 결제사를 부르지 않고 이유를 보인다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'payment_reconciliation_cooldown' } });
    expect(await reconcilePaymentAttemptAction({ attemptId, operationId })).toEqual({ ok: false, error: '방금 확인한 결제입니다. 1분 뒤 다시 시도해주세요.' });
    mocks.rpc.mockResolvedValue({ data: { ...begun, attemptId: operationId }, error: null });
    expect((await reconcilePaymentAttemptAction({ attemptId, operationId })).ok).toBe(false);
    mocks.rpc.mockResolvedValue({ data: { ...begun, caseRef: 'leaked secret' }, error: null });
    expect((await reconcilePaymentAttemptAction({ attemptId, operationId })).ok).toBe(false);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('잘못된 식별자는 아무것도 부르지 않는다', async () => {
    expect((await reconcilePaymentAttemptAction({ attemptId: 'x', operationId })).ok).toBe(false);
    expect((await reconcilePaymentAttemptAction({ attemptId, operationId: '' })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('확인 중·지원하지 않음·결제사 설정 없음·실패를 성공으로 보고하지 않는다', async () => {
    for (const [kind, text] of [['in_progress', '다른 처리'], ['unsupported', '수동 복구'], ['unavailable', '연결 설정'], ['failed', '다시 시도']] as const) {
      mocks.reconcile.mockResolvedValueOnce({ kind });
      const result = await reconcilePaymentAttemptAction({ attemptId, operationId });
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain(text);
    }
  });
});
