import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminHomeLayoutAction } from './home-layout-actions';
import { resolveHomeLayoutBlocks } from '@/lib/home-layout';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
function form() {
  const data = new FormData();
  data.set('operationId', '11111111-1111-4111-8111-111111111111');
  data.set('expectedRevision', '3');
  data.set('blocks', JSON.stringify(resolveHomeLayoutBlocks(null, [])));
  return data;
}
describe('home layout save action', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'staff' } }); mocks.rpc.mockResolvedValue({ data: 4, error: null }); });
  it('sends the concurrency and idempotency contract and revalidates only after success', async () => {
    expect(await saveAdminHomeLayoutAction({}, form())).toEqual({ message: '홈 영역 순서와 노출 설정을 저장했습니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_home_layout', { target_operation_id: '11111111-1111-4111-8111-111111111111', expected_revision: 3, target_blocks: resolveHomeLayoutBlocks(null, []) });
    expect(mocks.revalidate.mock.calls).toEqual([['/'], ['/admin/display/curations']]);
  });
  it('invalid input and non-staff never call the RPC', async () => {
    const invalid = form(); invalid.set('blocks', '[]');
    expect((await saveAdminHomeLayoutAction({}, invalid)).errors).toBeDefined();
    mocks.access.mockResolvedValue(null);
    expect((await saveAdminHomeLayoutAction({}, form())).errors).toEqual({ form: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('marks stale revisions for explicit reload and preserves the draft without revalidation', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'home_layout_conflict' } });
    expect(await saveAdminHomeLayoutAction({}, form())).toMatchObject({ conflict: true, errors: { form: expect.stringContaining('입력은 유지') } });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
