import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ requireAdminScreenAccess: vi.fn(), loadAdminFaq: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.requireAdminScreenAccess }));
vi.mock('@/lib/faq.server', () => ({ loadAdminFaq: mocks.loadAdminFaq }));
vi.mock('@/components/admin/screens/FaqScreen', () => ({ FaqScreen: () => null }));
beforeEach(() => { mocks.requireAdminScreenAccess.mockReset(); mocks.loadAdminFaq.mockReset(); });
describe('FAQ 운영 라우트', () => {
  it('화면 권한을 먼저 확인해 비스태프가 초안 로더에 닿지 못한다', async () => {
    mocks.requireAdminScreenAccess.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.requireAdminScreenAccess).toHaveBeenCalledWith('/admin/cs/faq');
    expect(mocks.loadAdminFaq).not.toHaveBeenCalled();
  });
});
