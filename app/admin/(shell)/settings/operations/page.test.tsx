import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/operations-contacts.server', () => ({ loadAdminOperationsContacts: mocks.load }));
vi.mock('@/components/admin/screens/OperationsSettingsScreen', () => ({ OperationsSettingsScreen: () => null }));
import Page from './page';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ role: 'staff' });
  mocks.load.mockResolvedValue({ contacts: [], history: [] });
});
it('페이지 접근 권한을 확인한 뒤 연락처를 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.load).not.toHaveBeenCalled();
});
it('직원에게 조회 전용 화면을 전달한다', async () => {
  const result = await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/operations');
  expect(result.props.canEdit).toBe(false);
});
