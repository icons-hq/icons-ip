import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), signal: new Error('NEXT_REDIRECT') }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
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
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { ipId: 'rilakkuma' }, error: null });
});
describe('옵션 사용·복원 액션', () => {
  it('복원 RPC 입력과 모든 공개 가격·구매 표면 갱신을 유지한다', async () => {
    expect(await setGoodsVariantActiveAction({}, form())).toEqual({ message: '옵션을 복원했습니다.' });
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
  it('사용 중지에는 복원 가격을 보내지 않는다', async () => {
    expect(await setGoodsVariantActiveAction({}, form({ active: 'false', price: '' }))).toHaveProperty('message');
    expect(mocks.rpc.mock.calls[0][1].target_price).toBeNull();
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
  it('프레임워크 제어 예외는 폼 오류로 삼키지 않는다', async () => {
    mocks.rpc.mockRejectedValue(mocks.signal);
    await expect(setGoodsVariantActiveAction({}, form())).rejects.toBe(mocks.signal);
  });
});
