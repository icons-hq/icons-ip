import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { recordOrderClaimRefundAction } from './claim-actions';

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), createClient: vi.fn(), detail: vi.fn(), recover: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.detail }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: vi.fn() }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: mocks.recover }));

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ claimId: CLAIM_ID, orderId: 'order-1', method: 'pg_cancel', stage: 'completed' })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.detail.mockResolvedValue({ claim: { id: CLAIM_ID, orderId: 'order-1', stage: 'approved' }, payment: { provider: 'korpay' }, refund: { method: null } });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_goods_manual_recovery_attempts'
    ? [{ request_id: CLAIM_ID, manual_recovery_available: true, attempt_id: 'attempt-1' }] : null }));
  mocks.recover.mockResolvedValue({ outcome: 'provider_cancel_confirmed' });
});

describe('클레임 결제 정합화 권한', () => {
  it('주매니저는 프로필 staff여도 sales.manage 권한으로 수동 정합화를 완료한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'primary-1' }, role: 'staff', operatorAccess: configuredOperatorAccessFixture('primary') });
    expect(await recordOrderClaimRefundAction({}, form())).toMatchObject({ message: expect.stringContaining('환불 완료') });
    expect(mocks.recover).toHaveBeenCalledWith({ operation: 'provider_cancel_confirmed', attemptId: 'attempt-1', actorId: 'primary-1', requestId: CLAIM_ID, operatorAttested: true });
  });
  it('기존 staff의 admin 전용 수동 정합화 제한을 유지한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'staff-1' }, role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') });
    expect(await recordOrderClaimRefundAction({}, form())).toMatchObject({ error: expect.stringContaining('권한 전환 전에는 기존 관리자') });
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.anything());
  });
  it.each(['deputy', 'influencer', 'agency', 'logistics'] as const)('%s는 프로필 admin이어도 처리 RPC 전에 차단한다', async (role) => {
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'restricted-1' }, role: 'admin', operatorAccess: configuredOperatorAccessFixture(role) });
    expect(await recordOrderClaimRefundAction({}, form())).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});
