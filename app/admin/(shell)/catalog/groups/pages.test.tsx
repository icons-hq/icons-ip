import { beforeEach, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { groupTestGroup as group, groupTestIdentity as identity, groupTestSource as source } from '@/lib/admin/goods-groups.test-fixtures';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), groups: vi.fn(), group: vi.fn(), source: vi.fn(), create: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/goods-groups.server', () => ({ loadGoodsGroups: mocks.groups, loadGoodsGroup: mocks.group, loadGoodsGroupSource: mocks.source }));
vi.mock('@/lib/admin/goods-group-console.server', () => ({ loadGoodsGroupConsole: mocks.groups }));
vi.mock('@/lib/admin/category.server', () => ({ loadGoodsCategoryOptions: async () => [] }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: async () => [] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('@/components/admin/screens/GoodsGroupsScreen', () => ({ GoodsGroupsScreen: () => null }));
vi.mock('@/components/admin/GoodsGroupConversion', () => ({ GoodsGroupConversion: () => null }));
vi.mock('@/components/admin/GoodsGroupEditor', () => ({ GoodsGroupEditor: () => null }));
import Page from './page';
import NewPage from './new/page';
import { GoodsGroupsScreen } from '@/components/admin/screens/GoodsGroupsScreen';
import { GoodsGroupConversion } from '@/components/admin/GoodsGroupConversion';
import { GoodsGroupEditor } from '@/components/admin/GoodsGroupEditor';
function children(value: ReactNode): ReactElement<Record<string, unknown>>[] { return Children.toArray(value).flatMap(row => isValidElement<Record<string, unknown>>(row) ? [row, ...children(row.props.children as ReactNode)] : []); }
beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ user: { id: identity.actorId } }); mocks.create.mockResolvedValue({ auth: { getSession: mocks.session } });
  mocks.session.mockResolvedValue({ data: { session: { user: { id: identity.actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: identity.sessionId })).toString('base64url')}.x` } } });
  mocks.groups.mockResolvedValue({ rows: [group], total: 1, page: 1, pageSize: 30 }); mocks.group.mockResolvedValue(group); mocks.source.mockResolvedValue(source);
});
it('모든 경로는 catalog.manage 인가 후에만 데이터를 조회한다', async () => {
  mocks.guard.mockRejectedValue(new Error('forbidden')); await expect(Page({})).rejects.toThrow('forbidden'); await expect(NewPage({})).rejects.toThrow('forbidden');
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.groups).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
});
it('목록은 서버 페이지 조회만 하고 actor/session을 함께 전달한다', async () => {
  const result = await Page({ searchParams: Promise.resolve({ q: ' 검색 ', page: '2' }) }); expect(result.type).toBe(GoodsGroupsScreen);
  expect(mocks.guard).toHaveBeenCalledWith('/admin/catalog/groups', { capability: 'catalog.manage' }); expect(mocks.groups).toHaveBeenCalledWith(expect.objectContaining({ query: '검색', page: 2, pageSize: 50 })); expect(mocks.group).not.toHaveBeenCalled();
  expect(result.props).toMatchObject({ actorId: identity.actorId, sessionId: identity.sessionId, initialFilters: expect.objectContaining({ query: '검색' }) });
});
it('정확한 그룹을 읽고 없는 그룹·잘못된 매개변수는 404로 처리한다', async () => {
  const result = await Page({ searchParams: Promise.resolve({ id: group.id }) }); expect(mocks.group).toHaveBeenCalledWith(group.id); expect(mocks.groups).not.toHaveBeenCalled(); expect(result.props.initialGroup).toEqual(group);
  mocks.group.mockResolvedValue(null); await expect(Page({ searchParams: Promise.resolve({ id: group.id }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  await expect(Page({ searchParams: Promise.resolve({ id: ['wrong', group.id] }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
});
it('변환 URL의 실제 상품을 선선택하고 단일상품 구성은 원상품을 조회하지 않는다', async () => {
  const conversion = await NewPage({ searchParams: Promise.resolve({ sourceGoodId: source.goodId }) });
  expect(children(conversion).find(row => row.type === GoodsGroupConversion)?.props).toMatchObject({ initialSource: source, actorId: identity.actorId, sessionId: identity.sessionId });
  expect(mocks.source).toHaveBeenCalledWith(source.goodId); mocks.source.mockClear();
  const creation = await NewPage({ searchParams: Promise.resolve({ mode: 'assemble' }) }); const props = children(creation).find(row => row.type === GoodsGroupEditor)?.props;
  expect(props?.initial).toBeNull(); expect(props?.newGroupId).toMatch(/^[0-9a-f-]{36}$/); expect(mocks.source).not.toHaveBeenCalled();
});
it('인가 뒤 세션 계정이 바뀌면 편집 가능한 세션으로 넘기지 않는다', async () => {
  mocks.session.mockResolvedValue({ data: { session: { user: { id: 'different' }, access_token: 'untrusted' } } }); const result = await Page({}); expect(result.props.sessionId).toBeNull();
});
