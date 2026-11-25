const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), signal: new Error('NEXT_REDIRECT'), after: vi.fn(), restockEmails: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/email/transactional.server', () => ({ sendRestockAlertEmails: mocks.restockEmails }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error === mocks.signal || (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:'))) throw error; },
}));
import { setGoodsVariantActiveAction } from './goods-variant-actions';
const variantId = '123e4567-e89b-42d3-a456-426614174000';
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ goodId: 'g1', variantId, active: 'true', expectedUpdatedAt: '2026-09-01T00:00:00Z', price: '2000', ...values }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { ipId: 'rilakkuma' }, error: null });
});
describe('옵션 사용 중지·다시 사용 액션', () => {
  it('다시 사용 RPC 입력과 모든 공개 가격·구매 표면 갱신을 유지한다', async () => {
    expect(await setGoodsVariantActiveAction({}, form())).toEqual({ message: '옵션을 다시 사용합니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_goods_variant_active', {
      target_good_id: 'g1', target_variant_id: variantId, target_active: true,
      target_expected_updated_at: '2026-09-01T00:00:00Z', target_price: 2000,
    });
    for (const path of ['/admin/catalog/goods', '/shop', '/shop/new', '/shop/best', '/cart', '/checkout']) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/checkout/[orderId]', 'page');
  });
  /* 옵션을 다시 사용하면 재입고 전이일 수 있다 — 굿즈 저장·실재고 조정처럼 응답 뒤 재입고 메일을 보낸다(L2 리뷰 l2-data-2). */
  it('다시 사용에 성공하면 응답 뒤 재입고 메일을 보내고, 사용 중지·실패에는 보내지 않는다', async () => {
    await setGoodsVariantActiveAction({}, form());
    expect(mocks.after).toHaveBeenCalledTimes(1);
    (mocks.after.mock.calls[0][0] as () => unknown)();
    expect(mocks.restockEmails).toHaveBeenCalledWith('g1');
    mocks.after.mockClear();
    await setGoodsVariantActiveAction({}, form({ active: 'false', price: '' }));
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'goods_variant_changed' } });
    await setGoodsVariantActiveAction({}, form());
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('사용 중지에는 다시 사용할 판매가를 보내지 않는다', async () => {
    expect(await setGoodsVariantActiveAction({}, form({ active: 'false', price: '' }))).toEqual({ message: '옵션을 사용 중지했습니다. 재고와 주문 기록은 그대로 남습니다.' });
    expect(mocks.rpc.mock.calls[0][1].target_price).toBeNull();
  });
  /* 화면 규칙 4: 옵션의 이 상태는 '사용 중지', 되돌리기는 '다시 사용'이다. 상품의 상태인 '보관'·'복원'은 상품을 말할 때만 쓴다. */
  it.each([
    ['variant_price_below_base', '다시 사용할 판매가는 지금 상품 판매가 이상이어야 합니다.'],
    ['goods_options_limit', '사용 중인 옵션은 100개까지 둘 수 있습니다. 다른 옵션을 먼저 사용 중지해주세요.'],
    ['goods_variant_combination_exists', '옵션값이 같은 옵션이 이미 사용 중입니다. 그 옵션을 확인해주세요.'],
    ['catalog_archived', '보관된 상품입니다. 상품을 복원한 뒤 옵션을 변경해주세요.'],
  ])('거절 %s 는 옵션 상태를 한 이름으로 말한다', async (message, copy) => {
    mocks.rpc.mockResolvedValueOnce({ error: { message } });
    expect(await setGoodsVariantActiveAction({}, form())).toEqual({ error: copy });
    expect(await setGoodsVariantActiveAction({}, form({ price: '-1' }))).toEqual({ error: '옵션과 다시 사용할 판매가를 확인해주세요. 목록이 오래되었다면 새로고침해주세요.' });
  });
  it.each<Record<string, string>>([{ variantId: 'bad' }, { price: '-1' }, { price: '1.1' }, { expectedUpdatedAt: 'bad' }, { active: 'yes' }])('잘못된 입력을 RPC 전에 거절한다', async values => {
    expect(await setGoodsVariantActiveAction({}, form(values))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('미로그인은 복귀 경로로 보내고 권한 없음은 폼 오류로 반환한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, isStaff: false });
    await expect(setGoodsVariantActiveAction({}, form())).rejects.toThrow('/login?next=%2Fadmin%2Fcatalog%2Fgoods');
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user' }, isStaff: false });
    expect(await setGoodsVariantActiveAction({}, form())).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('RPC 충돌과 네트워크 예외는 폼 상태이며 실패 시 캐시를 갱신하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'goods_variant_changed' } });
    expect((await setGoodsVariantActiveAction({}, form())).error).toContain('변경');
    mocks.rpc.mockRejectedValueOnce(new Error('private backend details'));
    expect((await setGoodsVariantActiveAction({}, form())).error).toContain('잠시 후');
    mocks.client.mockRejectedValueOnce(new Error('connection lost'));
    expect((await setGoodsVariantActiveAction({}, form())).error).toContain('잠시 후');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  /* D5② 랜덤 판매 상품의 옵션을 판매중지·복원해 조건(옵션 2개 이상·기본 옵션 판매·같은 가격)이 깨지면 커밋에서 거절된다. */
  it.each([
    ['random_option_count', '판매 중인 옵션이 2개 이상이어야 랜덤 판매를 쓸 수 있습니다.'],
    ['random_option_default_inactive', '첫 번째(기본) 옵션이 판매 중이어야 랜덤 판매를 쓸 수 있습니다.'],
    ['random_option_price_mismatch', '랜덤 판매 상품은 판매 중인 모든 옵션의 판매가와 기간 할인이 같아야 합니다. 기간 할인은 모든 옵션에 한 번에 넣으세요.'],
  ])('랜덤 판매 조건 거절 %s 는 이유를 알리고 캐시를 갱신하지 않는다', async (message, copy) => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: '23514', message } });
    expect(await setGoodsVariantActiveAction({}, form({ active: 'false' }))).toEqual({ error: copy });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('프레임워크 제어 예외는 폼 오류로 삼키지 않는다', async () => {
    mocks.rpc.mockRejectedValue(mocks.signal);
    await expect(setGoodsVariantActiveAction({}, form())).rejects.toBe(mocks.signal);
  });
});
