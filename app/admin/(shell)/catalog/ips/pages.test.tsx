import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), workspace: vi.fn(), index: vi.fn(), catalog: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/ip-workspace.server', () => ({ loadAdminIpWorkspace: mocks.workspace, loadAdminIpIndex: mocks.index }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: mocks.catalog }));
vi.mock('@/components/admin/screens/IpScreen', () => ({ IpScreen: () => null }));
vi.mock('@/components/admin/screens/IpWorkspaceScreen', () => ({ IpWorkspaceScreen: () => null }));
vi.mock('@/components/admin/screens/IpIndexScreen', () => ({ IpIndexScreen: () => null }));
import IndexPage from './page';
import WorkspacePage from './[ipId]/page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'operator' } });
  mocks.index.mockResolvedValue({});
  mocks.catalog.mockResolvedValue({ verticals: [] });
  mocks.workspace.mockResolvedValue({ ip: { id: 'hwasan' }, verticals: [], tab: 'basic' });
});
describe('IP routes', () => {
  it('stops unauthorized readers before either loader runs', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(IndexPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden');
    await expect(WorkspacePage({ params: Promise.resolve({ ipId: 'hwasan' }), searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden');
    expect(mocks.index).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it('routes index search and opens the selected IP through its own guarded path', async () => {
    await IndexPage({ searchParams: Promise.resolve({ q: ' 화산 ', vertical: 'webtoon' }) });
    expect(mocks.index).toHaveBeenCalledWith({ query: '화산', vertical: 'webtoon', status: 'active', page: 1 });
    await WorkspacePage({ params: Promise.resolve({ ipId: 'hwasan' }), searchParams: Promise.resolve({ tab: 'goods' }) });
    expect(mocks.guard).toHaveBeenCalledWith('/admin/catalog/ips/hwasan');
    expect(mocks.workspace).toHaveBeenCalledWith('hwasan', 'goods');
  });
  it('returns 404 for an absent IP and keeps new-IP creation account scoped', async () => {
    mocks.workspace.mockResolvedValue(null);
    await expect(WorkspacePage({ params: Promise.resolve({ ipId: 'missing' }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    const result = await IndexPage({ searchParams: Promise.resolve({ create: '1' }) });
    expect(result.props.children[1].props.accountId).toBe('operator');
    expect(result.props.children[1].props.records).toEqual([]);
  });
});
