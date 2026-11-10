import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { getOrderAddressContext, getOrderAddressReceipt } from './order-address.server';
import { orderAddressContextFixture as context, orderAddressReceiptFixture as receipt } from './order-address.fixture';
beforeEach(() => rpc.mockReset());
it('입력한 주문·요청번호와 다른 응답이나 손상된 응답은 성공으로 읽지 않는다', async () => {
  rpc.mockResolvedValue({ data: context, error: null }); expect(await getOrderAddressContext(context.orderId)).toEqual(context);
  await expect(getOrderAddressContext(receipt.id)).rejects.toThrow('context');
  rpc.mockResolvedValue({ data: receipt, error: null }); expect(await getOrderAddressReceipt(receipt.id)).toEqual(receipt);
  await expect(getOrderAddressReceipt(context.orderId)).rejects.toThrow('receipt');
  rpc.mockResolvedValue({ data: {}, error: null }); await expect(getOrderAddressReceipt(receipt.id)).rejects.toThrow('receipt');
});
it('아직 없는 결과와 권한·통신 오류를 구분한다', async () => {
  rpc.mockResolvedValue({ data: null, error: null }); expect(await getOrderAddressReceipt(receipt.id)).toBeNull();
  rpc.mockResolvedValue({ data: null, error: { code: '42501' } }); await expect(getOrderAddressReceipt(receipt.id)).rejects.toThrow('receipt');
});
