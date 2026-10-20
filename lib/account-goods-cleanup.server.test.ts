import { expect, it, vi } from 'vitest';
import { cleanupFencedGoodsAccount } from './account-goods-cleanup.server';
const actor = 'ab140000-0000-4000-8000-000000000001', gift = 'ab140000-0000-4000-8000-000000000002';
it('fence 이후 호출은 선물별 별도 RPC와 계정 cleanup을 순서대로 실행한다', async () => {
  const rpc = vi.fn(async (name: string) => ({ error: null, data: name === 'service_list_fenced_gifts' ? [gift] : name === 'service_cleanup_fenced_gift' ? { giftId: gift, state: 'cleaned' } : { state: 'deferred', quotesRemoved: 2 } }));
  expect(await cleanupFencedGoodsAccount(actor, { rpc })).toBe(true);
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['service_list_fenced_gifts', 'service_cleanup_fenced_gift', 'service_cleanup_fenced_goods_transactions']);
});
it('선물 일부 실패는 이미 확인된 정리를 되돌리지 않고 계정 cleanup도 실행한다', async () => {
  const rpc = vi.fn(async (name: string) => ({ error: name === 'service_cleanup_fenced_gift' ? { private: 'no disclosure' } : null, data: name === 'service_list_fenced_gifts' ? [gift] : { state: 'cleaned', quotesRemoved: 0 } }));
  expect(await cleanupFencedGoodsAccount(actor, { rpc })).toBe(false);expect(rpc).toHaveBeenCalledTimes(3);
});
it('부적합 actor·목록·미fence 응답을 정리 성공으로 인정하지 않는다', async () => {
  const rpc = vi.fn(async () => ({ data: { state: 'not_fenced' }, error: null }));
  expect(await cleanupFencedGoodsAccount('bad', { rpc })).toBe(false);expect(rpc).not.toHaveBeenCalled();
  expect(await cleanupFencedGoodsAccount(actor, { rpc })).toBe(false);
});
