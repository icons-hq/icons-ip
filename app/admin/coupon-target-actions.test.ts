const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), select: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(), signal: new Error('NEXT_REDIRECT') }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error === mocks.signal || (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:'))) throw error; },
}));
import { searchCouponCategoriesAction, searchCouponTargetGoodsAction } from './coupon-target-actions';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  for (const method of [mocks.rpc, mocks.select, mocks.is, mocks.order]) method.mockReturnValue(mocks);
  mocks.range.mockResolvedValue({ data: [{ id: 'g1', code: 'G1', name: '쿠션', archived_at: null }], count: 21, error: null });
});
describe('쿠폰 대상 상품 검색', () => {
  it('카테고리 검색은 페이지 응답과 차단 상태를 확인하고 권한 없는 고객은 조회하지 않는다', async () => {
    const item = { id: 'ca109300-0000-4000-8000-000000000001', name: '분류', path: '상위 > 분류', blocked: false };
    mocks.rpc.mockResolvedValue({ data: { rows: [item], total: 21, page: 2, pageSize: 20 }, error: null });
    expect(await searchCouponCategoriesAction(' 분류 ', 2)).toEqual({ ok: true, items: [item], total: 21, page: 2, pageSize: 20 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_coupon_categories', { p_query: '분류', p_page: 2 });
    mocks.rpc.mockResolvedValue({ data: { rows: [{ ...item, blocked: true }], total: 1, page: 1, pageSize: 20 }, error: null });
    expect(await searchCouponCategoriesAction('분류')).toMatchObject({ ok: false });
    mocks.rpc.mockClear(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user' }, isStaff: false });
    expect(await searchCouponCategoriesAction('분류')).toMatchObject({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('리터럴 검색어·보관 제외·안정 정렬과 페이지 범위를 RPC에 전달한다', async () => {
    expect(await searchCouponTargetGoodsAction('  %_  ', 2)).toEqual({ ok: true, items: [{ id: 'g1', code: 'G1', name: '쿠션', archivedAt: null }], total: 21, page: 2, pageSize: 20 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods', { search_text: '%_' }, { count: 'exact' });
    expect(mocks.is).toHaveBeenCalledWith('archived_at', null);
    expect(mocks.order.mock.calls).toEqual([['code'], ['id']]);
    expect(mocks.range).toHaveBeenCalledWith(20, 39);
  });
  it('미로그인을 쿠폰 화면 복귀 경로로 보내고 권한 없는 회원은 폼 오류를 받는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, isStaff: false });
    await expect(searchCouponTargetGoodsAction('a')).rejects.toThrow('/login?next=%2Fadmin%2Fsales%2Fcoupons');
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user' }, isStaff: false });
    expect(await searchCouponTargetGoodsAction('a')).toEqual({ ok: false, error: '상품 검색은 운영자만 할 수 있습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['a'.repeat(101), 1], ['a', 0], ['a', 1.1], ['a', 100001]])('범위를 벗어난 검색을 거절한다', async (query, page) => {
    expect(await searchCouponTargetGoodsAction(query, page)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('검색 오류·잘못된 행·건수와 연결 예외를 화면 오류로 반환한다', async () => {
    for (const value of [{ data: [], count: null }, { data: [], count: 0, error: { message: 'private' } }, { data: [{}], count: 1 }, { data: [{}], count: 0 }]) {
      mocks.range.mockResolvedValueOnce(value);
      expect(await searchCouponTargetGoodsAction('a')).toMatchObject({ ok: false });
    }
    mocks.range.mockRejectedValueOnce(new Error('private network details'));
    expect(await searchCouponTargetGoodsAction('a')).toEqual({ ok: false, error: '상품 검색 결과를 불러오지 못했습니다.' });
  });
  it('프레임워크 제어 예외는 다시 던진다', async () => {
    mocks.range.mockRejectedValue(mocks.signal);
    await expect(searchCouponTargetGoodsAction('a')).rejects.toBe(mocks.signal);
  });
});
