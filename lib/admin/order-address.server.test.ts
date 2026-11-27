import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, read: [] as string[] }));
/* 배송지 조회는 주문·배송 건도 읽어 우편번호·기본 주소를 잠글지 정한다. 표마다 준비한 응답을 돌려주는 대역이다(준비하지 않은 표는 읽기 실패). */
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from: (table: string) => {
  tables.read.push(table);
  const result = () => table in tables.rows ? { data: tables.rows[table], error: null } : { data: null, error: { message: 'unavailable' } };
  const query: Record<string, unknown> = { select: () => query, eq: () => query, maybeSingle: async () => result(), then: (resolve: (value: unknown) => void) => resolve(result()) };
  return query;
} }) }));
import { getOrderAddressContext, getOrderAddressReceipt } from './order-address.server';
import { orderAddressContextFixture as context, orderAddressReceiptFixture as receipt } from './order-address.fixture';
beforeEach(() => { rpc.mockReset(); tables.rows = {}; tables.read = []; });
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

/*
 * QA-O 고칠 것 4: 우편번호·기본 주소를 바꿀 수 없는 주문(배송비 기준 기록이 없는 주문)은 저장할 때에야 DB가 거절했다.
 * 조회가 같은 조건을 읽어 화면이 두 칸을 미리 잠그게 한다. 읽지 못하면 잠그지 않는다(판정은 DB).
 */
it('우편번호·기본 주소를 바꿀 수 없는 주문인지 함께 읽는다', async () => {
  const origin = '00000000-0000-4000-8000-000000042201';
  const snapshot = { originId: origin, policySubtotal: 10000, baseFee: 3000, freeThreshold: null, policyFee: 3000, individualFee: 0, totalFee: 3000 };
  const parcel = { origin_id: origin, delivery_method: 'parcel', shipping_fee: 3000, shipping_fee_snapshot: snapshot };
  rpc.mockResolvedValue({ data: context, error: null });

  tables.rows = { orders: { calculation_version: 1 }, order_shipments: [parcel] };
  expect(await getOrderAddressContext(context.orderId)).toEqual({ ...context, destinationLocked: false });
  expect(tables.read).toEqual(['orders', 'order_shipments']);
  tables.rows = { orders: { calculation_version: 1 }, order_shipments: [parcel, { ...parcel, delivery_method: 'pickup' }] };
  expect((await getOrderAddressContext(context.orderId)).destinationLocked).toBe(true);
  tables.rows = { orders: { calculation_version: 1 }, order_shipments: [{ ...parcel, shipping_fee_snapshot: null }] };
  expect((await getOrderAddressContext(context.orderId)).destinationLocked).toBe(true);
  /* 계산 방식 2 주문은 새 주소로 배송비를 다시 계산해 보므로 잠그지 않는다. */
  tables.rows = { orders: { calculation_version: 2 }, order_shipments: [{ ...parcel, shipping_fee_snapshot: null }] };
  expect((await getOrderAddressContext(context.orderId)).destinationLocked).toBe(false);
  /* 읽지 못하면 값을 싣지 않는다. */
  tables.rows = { orders: { calculation_version: 1 } };
  expect(await getOrderAddressContext(context.orderId)).toEqual(context);
  /* 바꿀 수 없는 주문은 입력 칸이 없어 읽지 않는다. */
  tables.read = []; rpc.mockResolvedValue({ data: { ...context, allowed: false, blocker: 'order_dispatched' }, error: null });
  expect(await getOrderAddressContext(context.orderId)).toEqual({ ...context, allowed: false, blocker: 'order_dispatched' });
  expect(tables.read).toEqual([]);
});
