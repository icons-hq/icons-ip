import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { adjustStoreCreditAction, saveStoreCreditPolicyAction } from './store-credit-actions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: '00000000-0000-4000-8000-000000004881' }, isStaff: true, role: 'admin' });
});
describe('적립금 운영 Server Action', () => {
  it('일반 직원의 금액 조정을 권한 경계에서 거절한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
    expect(await adjustStoreCreditAction({}, new FormData())).toMatchObject({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('정책 활성화에 필요한 실제값이 없으면 입력을 보존한다', async () => {
    const form = new FormData(); form.set('enabled', 'on'); form.set('evidence', '입력 유지');
    const result = await saveStoreCreditPolicyAction({}, form);
    expect(result).toMatchObject({ values: { evidence: '입력 유지', enabled: 'on' } });
    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('잔액 충돌을 설명하면서 금액과 사유를 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'store_credit_balance_conflict' } });
    const form = new FormData();
    for (const [key, value] of Object.entries({ userId: '00000000-0000-4000-8000-000000004882', operationId: '10000000-0000-4000-8000-000000004882', direction: 'debit', amount: '500', expectedAvailable: '1000', reason: '합성 정정 근거' })) form.set(key, value);
    const result = await adjustStoreCreditAction({}, form);
    expect(result).toMatchObject({ error: '다른 작업으로 내용이 변경됐습니다. 최신 내역을 확인해주세요.', values: { amount: '500', reason: '합성 정정 근거' } });
  });
});
