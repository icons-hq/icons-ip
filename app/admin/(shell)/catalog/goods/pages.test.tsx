import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn(), editor: vi.fn(), common: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/admin/goods-group-common.server', () => ({ loadGoodsGroupCommon: mocks.common }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getSession: mocks.session } }) }));
vi.mock('@/components/admin/GoodsGroupCommonEditor', () => ({ GoodsGroupCommonEditor: () => null }));
import { GoodsGroupCommonEditor } from '@/components/admin/GoodsGroupCommonEditor';
import { commonTestSnapshot } from '@/lib/admin/goods-group-common.test-fixtures';
import { groupTestIdentity as identity } from '@/lib/admin/goods-groups.test-fixtures';
vi.mock('@/lib/legal/business-info.server', () => ({ getBusinessInfo: async () => ({ companyName: '설정 회사', phone: '02-000', email: 'cs@example.com' }) }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/goods-list.server', () => ({ loadAdminGoodsList: mocks.list, loadAdminGoodEditor: mocks.editor }));
vi.mock('@/components/admin/screens/GoodScreen', () => ({ GoodScreen: () => null }));
vi.mock('@/components/admin/screens/GoodsListScreen', () => ({ GoodsListScreen: () => null }));
import Page from './page';

function editorScreen(children: ReactNode): ReactElement<ComponentProps<typeof GoodScreen>> {
  const screen = Children.toArray(children).find((child): child is ReactElement<ComponentProps<typeof GoodScreen>> => isValidElement(child) && child.type === GoodScreen);
  if (!screen) throw new Error('Missing goods editor screen');
  return screen;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.list.mockResolvedValue({});
  mocks.editor.mockResolvedValue({ records: { goods: [{ id: 'g999', name: '정확한 상품' }], ips: [{ id: 'draft-ip', archivedAt: null }] }, catalogIps: [], variants: [], origins: [{id:'origin'}] });
});
describe('goods directory routes', () => {
  it('공통 편집은 같은 RPC의 버전·필드와 현재 세션으로만 열린다', async () => {
    const snapshot = commonTestSnapshot();
    mocks.guard.mockResolvedValue({ user: { id: identity.actorId }, operatorAccess: { mode: 'configured', managerRole: 'primary', capabilities: ['catalog.read','catalog.manage'], revision: 1, setupRequired: false } });
    mocks.common.mockResolvedValue(snapshot);
    mocks.session.mockResolvedValue({ data: { session: { user: { id: identity.actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: identity.sessionId })).toString('base64url')}.x` } } });
    const page = await Page({ searchParams: Promise.resolve({ goodId: snapshot.group.commonGoodId, groupCommon: snapshot.group.id }) });
    expect(page.type).toBe(GoodsGroupCommonEditor); expect(page.props).toMatchObject({ snapshot, actorId: identity.actorId, sessionId: identity.sessionId });
    expect(mocks.common).toHaveBeenCalledWith(snapshot.group.id);
    mocks.common.mockResolvedValueOnce({ ...snapshot, group: { ...snapshot.group, revision: snapshot.group.revision + 1 } });
    const refreshed = await Page({ searchParams: Promise.resolve({ goodId: snapshot.group.commonGoodId, groupCommon: snapshot.group.id }) });
    expect(refreshed.key).toBe(page.key);
    await expect(Page({ searchParams: Promise.resolve({ goodId: 'different-product', groupCommon: snapshot.group.id }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
  it.each([{ groupCommon: 'bad' }, { groupCommon: 'bc1d0000-0000-4000-8000-000000000010' }, { create: '1', groupCommon: 'bc1d0000-0000-4000-8000-000000000010' }])('공통 편집의 잘못된 경로를 거절한다: %j', async params => {
    await expect(Page({ searchParams: Promise.resolve(params) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.common).not.toHaveBeenCalled();
  });
  it('공통 편집은 상품 조회 권한만으로 열리지 않는다', async () => {
    const snapshot = commonTestSnapshot();
    await expect(Page({ searchParams: Promise.resolve({ goodId: snapshot.group.commonGoodId, groupCommon: snapshot.group.id }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(mocks.editor).not.toHaveBeenCalled(); expect(mocks.common).not.toHaveBeenCalled();
  });

  it('requires staff before any list or editor read', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden');
    await expect(Page({ searchParams: Promise.resolve({ goodId: 'g999' }) })).rejects.toThrow('forbidden');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.editor).not.toHaveBeenCalled();
  });
  it('opens a server-paged list without any editor data', async () => {
    await Page({ searchParams: Promise.resolve({ q: ' CODE ', page: '2', stock: 'low' }) });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ query: 'CODE', page: 2, ipId: '', status: 'active', stock: 'low', categoryId: '', readiness: 'all', pageSize: 20, sort: 'created_desc' }));
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it('loads the exact editor id and preserves the URL filters in the return link', async () => {
    const result = await Page({ searchParams: Promise.resolve({ goodId: 'g999', page: '3', q: 'CODE', ipId: 'draft-ip' }) });
    expect(mocks.editor).toHaveBeenCalledWith('g999');
    expect(mocks.list).not.toHaveBeenCalled();
    const screen = editorScreen(result.props.children);
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
    const screen = editorScreen(create.props.children);
    expect(screen.props.noticeDefaults).toEqual({ asManager: '설정 회사', asContact: '02-000' });
    expect(screen.props.accountId).toBe('staff');
    expect(screen.props.initialIpId).toBe('draft-ip');
    expect(screen.props.records).toEqual([]);
    expect(mocks.editor).toHaveBeenLastCalledWith();
  });
});
