import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { saveIpDirectoryAction } from './ip-directory-actions';

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: 'hwasan', featured: 'on', position: '2', expectedFeatured: 'false', expectedOrder: '["hwasan","maplestory"]' })) data.set(key, value);
  return data;
}
beforeEach(() => {
  mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'staff' } });
  mocks.rpc.mockResolvedValue({ error: null });
  vi.clearAllMocks();
});
describe('IP directory action', () => {
  it('saves relative moves with a comparison snapshot and revalidates the public directory', async () => {
    const data = form(); data.set('move', 'down'); data.set('position', '999');
    expect((await saveIpDirectoryAction({}, data)).message).toContain('저장했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_ip_directory', {
      target_id: 'hwasan', target_featured: true, target_position: 2,
      expected_order: ['hwasan', 'maplestory'], expected_featured: false,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/ip');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/ips/hwasan');
  });
  it('rejects nonstaff and malformed snapshot submissions before writing', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: false, user: { id: 'user' } });
    expect((await saveIpDirectoryAction({}, form())).errors?.form).toContain('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'staff' } });
    const data = form(); data.set('expectedOrder', '["hwasan","hwasan"]');
    expect((await saveIpDirectoryAction({}, data)).errors?.form).toContain('새로고침');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('retains values for infrastructure failures and preserves login redirects', async () => {
    mocks.auth.mockRejectedValue(new Error('offline'));
    expect((await saveIpDirectoryAction({}, form())).values?.id).toBe('hwasan');
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: false, user: null });
    await expect(saveIpDirectoryAction({}, form())).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT;') });
  });
  it('returns the five-featured limit without losing the submitted settings', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'ip_featured_limit' } });
    const result = await saveIpDirectoryAction({}, form());
    expect(result.errors?.form).toContain('최대 5개');
    expect(result.values?.position).toBe('2');
    expect(result.attempt).toBe(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
