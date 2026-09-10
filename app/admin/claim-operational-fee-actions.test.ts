import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordOrderClaimOperationalFeeAction } from './claim-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' },
  rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: vi.fn() }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: vi.fn() }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: vi.fn() }));

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    claimId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', claimType: 'return',
    expectedUpdatedAt: '2026-09-10T00:00:00Z', feeKind: 'return_shipping', amount: '0',
    note: '무료 확인', evidence: '택배 회신', ...overrides,
  })) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: { amount: 0 }, error: null });
  mocks.revalidatePath.mockReset();
});

describe('운영 확인액 기록 액션', () => {
  it('RPC 연결 예외도 입력을 보존하고 안전한 재시도 오류를 반환한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('private connection data'));
    const result = await recordOrderClaimOperationalFeeAction({}, form({ amount: '1200' }));
    expect(result.error).toBeTruthy();
    expect(result.values?.amount).toBe('1200');
    expect(JSON.stringify(result)).not.toContain('private connection data');
  });
  it('0원과 null 해제를 RPC에 그대로 전달한다', async () => {
    const saved = await recordOrderClaimOperationalFeeAction({}, form());
    expect(saved.message).toContain('기록했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_operational_fee', expect.objectContaining({ p_amount: 0 }));
    const cleared = await recordOrderClaimOperationalFeeAction({}, form({ amount: '', feeKind: '', note: '', evidence: '' }));
    expect(cleared.message).toContain('해제했습니다');
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_record_order_claim_operational_fee', expect.objectContaining({ p_amount: null, p_fee_kind: null }));
  });

  it('충돌과 권한 오류는 입력을 보존하고 외부 원문을 숨긴다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'claim_operational_fee_conflict private_detail' } });
    const result = await recordOrderClaimOperationalFeeAction({}, form({ amount: '1200' }));
    expect(result.error).toContain('다른 운영자');
    expect(result.values?.amount).toBe('1200');
    expect(JSON.stringify(result)).not.toContain('private_detail');
    mocks.auth.isStaff = false;
    expect((await recordOrderClaimOperationalFeeAction({}, form())).error).toContain('권한');
  });
});
