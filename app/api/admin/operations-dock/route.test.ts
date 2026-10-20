import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), alerts: vi.fn(), tasks: vi.fn(), help: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/operations-dock.server', () => ({ getAdminOperationAlerts: mocks.alerts, getAdminOperationTasks: mocks.tasks }));
vi.mock('@/lib/admin/operations-help.server', () => ({ searchAdminOperationHelp: mocks.help }));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ role: 'staff' }); mocks.alerts.mockResolvedValue({ items: [] }); mocks.tasks.mockResolvedValue([]); mocks.help.mockReturnValue({ entries: [], total: 0 }); });
describe('운영 업무 도구 조회', () => {
  it('권한 실패 뒤 업무정보를 조회하지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(GET(new Request('https://example.test/api/admin/operations-dock'))).rejects.toThrow('forbidden');
    expect(mocks.alerts).not.toHaveBeenCalled();
  });
  it('계정 권한·현재화면을 도움말에 전달하고 캐시를 공유하지 않는다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/operations-dock?section=help&path=/admin/sales/orders&q=배송'));
    expect(mocks.help).toHaveBeenCalledWith('배송', '/admin/sales/orders', { role: 'staff' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('불완전한 커서는 쿼리 전에 거절한다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/operations-dock?before=2026-10-12'));
    expect(response.status).toBe(400); expect(mocks.alerts).not.toHaveBeenCalled();
  });
  it('조회 실패를 빈 목록으로 바꾸지 않는다', async () => {
    mocks.tasks.mockRejectedValueOnce(new Error('unavailable'));
    expect((await GET(new Request('https://example.test/api/admin/operations-dock?section=tasks'))).status).toBe(500);
  });
});
