import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn(), editor: vi.fn() }));
vi.mock('@/lib/legal/business-info.server', () => ({ getBusinessInfo: async () => ({ companyName: '설정 회사', phone: '02-000', email: 'cs@example.com' }) }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/goods-list.server', () => ({ loadAdminGoodsList: mocks.list, loadAdminGoodEditor: mocks.editor }));
vi.mock('@/components/admin/screens/GoodScreen', () => ({ GoodScreen: () => null }));
vi.mock('@/components/admin/screens/GoodsListScreen', () => ({ GoodsListScreen: () => null }));
import Page from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.list.mockResolvedValue({});
  mocks.editor.mockResolvedValue({ records: { goods: [{ id: 'g999', name: '정확한 상품' }], ips: [{ id: 'draft-ip', archivedAt: null }] }, catalogIps: [], variants: [], origins: [{id:'origin'}] });
});
describe('goods directory routes', () => {
  it('requires staff before any list or editor read', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden');
    await expect(Page({ searchParams: Promise.resolve({ goodId: 'g999' }) })).rejects.toThrow('forbidden');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.editor).not.toHaveBeenCalled();
  });
  it('opens a server-paged list without any editor data', async () => {
    await Page({ searchParams: Promise.resolve({ q: ' CODE ', page: '2', stock: 'low' }) });
    expect(mocks.list).toHaveBeenCalledWith({ query: 'CODE', page: 2, ipId: '', status: 'active', stock: 'low' });
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it('loads the exact editor id and preserves the URL filters in the return link', async () => {
    const result = await Page({ searchParams: Promise.resolve({ goodId: 'g999', page: '3', q: 'CODE', ipId: 'draft-ip' }) });
    expect(mocks.editor).toHaveBeenCalledWith('g999');
    expect(mocks.list).not.toHaveBeenCalled();
    const screen = result.props.children[2];
    expect(screen.props.initialSelectedId).toBe('g999');
    expect(screen.props.hideRecordList).toBe(true);
    expect(screen.props.origins).toEqual([{id:'origin'}]);
    expect(screen.props.accountId).toBe('staff');
    expect(screen.props.listHref).toContain('page=3');
    expect(screen.props.listHref).toContain('q=CODE');
    expect(screen.props.adjustmentId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('rejects absent edit targets and preselects an active draft IP for creation', async () => {
    mocks.editor.mockResolvedValueOnce({ records: { goods: [], ips: [] }, catalogIps: [], variants: [], origins: [{id:'origin'}] });
    await expect(Page({ searchParams: Promise.resolve({ goodId: 'missing' }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    const create = await Page({ searchParams: Promise.resolve({ create: '1', ipId: 'draft-ip' }) });
    expect(create.props.children[2].props.noticeDefaults).toEqual({ asManager: '설정 회사', asContact: '02-000' });
    expect(create.props.children[2].props.accountId).toBe('staff');
    expect(create.props.children[2].props.initialIpId).toBe('draft-ip');
    expect(create.props.children[2].props.records).toEqual([]);
    expect(mocks.editor).toHaveBeenLastCalledWith();
  });
});
