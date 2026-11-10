import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allow: true, rpc: vi.fn(), updateTag: vi.fn(), revalidatePath: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ updateTag: mocks.updateTag, revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { saveStoreNavigationAction } from './store-navigation-actions';
import { DEFAULT_STORE_NAVIGATION } from '@/lib/store-navigation';
const stamp = '2026-10-13T01:00:00.000001Z';
const operation = '00000000-0000-4000-8000-000000019001';
beforeEach(() => {
  mocks.allow = true; mocks.access.mockReset().mockImplementation(async () => mocks.allow);
  mocks.rpc.mockReset().mockResolvedValue({ data: '2026-10-13T02:00:00.000001Z', error: null });
  mocks.updateTag.mockClear(); mocks.revalidatePath.mockClear();
});
it('admin 권한과 구조·요청 식별자 검증을 통과한 경우만 DB를 호출한다', async () => {
  mocks.allow = false; expect((await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, operation)).error).toContain('admin');
  mocks.allow = true; expect((await saveStoreNavigationAction([], stamp, operation)).error).toContain('7개');
  expect((await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, 'bad')).error).toContain('다시 열어');
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith('/admin/settings/store', { adminOnly: true, capability: 'store.manage' });
});
it('같은 작업 ID와 편집 시각을 보내고 확정된 성공만 공개 캐시에 반영한다', async () => {
  expect((await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, operation)).updatedAt).toBe('2026-10-13T02:00:00.000001Z');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_navigation', { target_operation_id: operation, target_values: DEFAULT_STORE_NAVIGATION, expected_updated_at: stamp });
  expect(mocks.updateTag).toHaveBeenCalledWith('store-settings');
  expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
});
it('충돌·잘못된 readback·전송 오류를 성공으로 표시하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'store_settings_conflict internal-secret' } });
  const result = await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, operation);
  expect(result.error).toContain('다른 관리자'); expect(JSON.stringify(result)).not.toContain('internal-secret');
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect((await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, operation)).error).toContain('결과를 확인');
  mocks.rpc.mockRejectedValueOnce(new Error('lost'));
  expect((await saveStoreNavigationAction(DEFAULT_STORE_NAVIGATION, stamp, operation)).error).toContain('입력값은 유지');
  expect(mocks.updateTag).not.toHaveBeenCalled();
});
