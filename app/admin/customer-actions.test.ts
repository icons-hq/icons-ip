import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addCustomerNoteAction, loadCustomerHistoryAction } from './customer-actions';
const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true }, rpc: vi.fn(), load: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/customer-detail.server', () => ({ getAdminCustomerDetail: mocks.load }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
const ID = '00000000-0000-4000-8000-000000004301';
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ userId: ID, tab: 'orders', page: '2', body: '내부 상담 메모',
    operationId: '50000000-0000-4000-8000-000000004301', ...values })) data.set(key, value);
  return data;
}
beforeEach(() => {
  mocks.auth.isStaff = true; mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.load.mockReset().mockResolvedValue({ customer: { email: 'not-part-of-inline-result' }, tab: 'orders', page: 2, pageSize: 20, total: 25, items: [{ id: 'order-21' }] });
  mocks.revalidate.mockReset();
});
describe('고객 작업', () => {
  it('문의 화면의 고객 이력은 지정 페이지와 주문 행만 반환한다', async () => {
    const result = await loadCustomerHistoryAction({}, form());
    expect(result.history?.items).toEqual([{ id: 'order-21' }]);
    expect(result.history?.userId).toBe(ID);
    expect(result.history?.page).toBe(2);
    expect(JSON.stringify(result)).not.toContain('not-part-of-inline-result');
  });
  it('일반 회원은 고객 이력과 내부 메모 작업을 할 수 없다', async () => {
    mocks.auth.isStaff = false;
    expect((await loadCustomerHistoryAction({}, form())).error).toContain('권한');
    expect((await addCustomerNoteAction({}, form())).error).toContain('권한');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('메모 재시도 성공은 고객 페이지를 갱신하고 실패 시 성공 신호를 내지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await addCustomerNoteAction({}, form())).message).toContain('저장했습니다');
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/customers/${ID}`);
    mocks.rpc.mockRejectedValue(new Error('private-database-error'));
    const failed = await addCustomerNoteAction({}, form());
    expect(failed.error).toContain('입력한 메모는 유지');
    expect(failed.resultKey).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain('private-database-error');
  });
});
