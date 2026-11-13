import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
import { loadGoodShippingPolicy } from '@/lib/fulfillment.server';
import { loadMyOrderReturnPickup } from '@/lib/orders/return-pickup.server';

beforeEach(() => { vi.resetAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); });

/* QNA-032: 상품 상세·주문 상세의 방문 회수 안내는 DB 스위치가 true를 돌려줄 때만 켠다. 읽지 못하면 지금 안내 그대로다. */
describe('방문 회수 안내 읽기', () => {
  const policy = { originId: 'origin', originName: '창고', baseFee: 3000, freeThreshold: null, feeType: 'policy', individualFee: 0 };
  it('상품 상세 배송 정책은 굿즈의 출고지 회수 계약이 켜져 있을 때만 returnPickup을 싣는다', async () => {
    let pickup: unknown = { data: false, error: null };
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_good_shipping_policy' ? { data: policy, error: null }
      : name === 'get_good_return_pickup' ? pickup : { data: null, error: { message: 'missing' } });
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_return_pickup', { target_good_id: 'good' });
    pickup = { data: true, error: null };
    expect(await loadGoodShippingPolicy('good')).toEqual({ ...policy, returnPickup: true });
    pickup = { data: null, error: { code: 'PGRST202', message: 'missing function' } };
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
  });
  it('주문 상세는 본인 주문 RPC가 준 방문 회수·직접 발송 묶음 수를 읽고, 읽지 못하면 둘 다 0이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { pickupBundles: 1, directBundles: 1 }, error: null });
    expect(await loadMyOrderReturnPickup('order')).toEqual({ pickupBundles: 1, directBundles: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_order_return_pickup', { p_order_id: 'order' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await loadMyOrderReturnPickup('order')).toEqual({ pickupBundles: 0, directBundles: 0 });
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }); // 이전 모양(boolean)은 읽지 않는다 — 지금 문장.
    expect(await loadMyOrderReturnPickup('order')).toEqual({ pickupBundles: 0, directBundles: 0 });
  });
});
