import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionDisplay, transactionLineId, transactionOrder, transactionQuoteId } from '@/test/fixtures/cart-transaction';
import { loadOrderLineViews, type OrderLineOrderInput } from './order-lines.server';

const mocks = vi.hoisted(() => ({ adult: vi.fn() }));
vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsAccess: mocks.adult }));

const GOOD = 'transaction-good';
const VARIANT = transactionDisplay.lines[0].variantId;

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface FakeOptions {
  goods?: Result | (() => Result | Promise<Result>);
  ips?: Result | (() => Result | Promise<Result>);
  receipt?: (orderId: string) => Result | Promise<Result>;
}

function fakeClient(options: FakeOptions = {}) {
  const calls = { goods: [] as string[][], ips: [] as string[][], receipts: [] as string[], activeReceipts: 0, maxActiveReceipts: 0 };
  const run = async (source: FakeOptions['goods'], fallback: Result): Promise<Result> => {
    const value = typeof source === 'function' ? await source() : source;
    return value ?? fallback;
  };
  const client = {
    from(table: string) {
      return {
        select: () => ({
          in: (_column: string, ids: string[]) => {
            if (table === 'goods') { calls.goods.push(ids); return run(options.goods, { data: [goodRow()], error: null }); }
            calls.ips.push(ids);
            return run(options.ips, { data: [{ id: 'ip-1', title: '홍실' }], error: null });
          },
        }),
      };
    },
    rpc: async (name: string, args: { p_order_id: string }) => {
      expect(name).toBe('get_my_goods_transaction_receipt');
      calls.receipts.push(args.p_order_id);
      calls.activeReceipts += 1;
      calls.maxActiveReceipts = Math.max(calls.maxActiveReceipts, calls.activeReceipts);
      await new Promise((resolve) => setTimeout(resolve, 1));
      calls.activeReceipts -= 1;
      return options.receipt ? options.receipt(args.p_order_id) : { data: { orderId: args.p_order_id, quoteId: transactionQuoteId, display: transactionDisplay }, error: null };
    },
  };
  return { client: client as never, calls };
}

function goodRow(overrides: Record<string, unknown> = {}) {
  return { id: GOOD, ip_id: 'ip-1', image_path: 'goods/a.webp', bg: null, sale_restriction: 'none', ...overrides };
}

function order(overrides: Partial<OrderLineOrderInput> = {}): OrderLineOrderInput {
  return {
    orderId: transactionOrder,
    tryReceipt: true,
    items: [{ key: 'item-1', lineId: transactionLineId, goodId: GOOD, variantId: VARIANT, name: '아크릴 스탠드', optionName: '파랑', qty: 2, unitPrice: 10000 }],
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mocks.adult.mockReset().mockResolvedValue('full');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorSpy.mockRestore();
});

describe('loadOrderLineViews', () => {
  it('굿즈·IP·거래 영수증을 읽어 썸네일·IP명·구매가/정가를 붙인다', async () => {
    const { client, calls } = fakeClient();
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toEqual([{
      key: 'item-1', goodId: GOOD, name: '아크릴 스탠드', optionName: '파랑', qty: 2, ipName: '홍실', adultMasked: false,
      thumbnail: 'url("https://project.supabase.test/storage/v1/object/public/public-media/goods/a.webp") center / cover no-repeat',
      purchaseAmount: 18000, regularAmount: 20000,
    }]);
    expect(calls.goods).toEqual([[GOOD]]);
    expect(calls.ips).toEqual([['ip-1']]);
    expect(calls.receipts).toEqual([transactionOrder]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('주문이 없으면 아무것도 읽지 않는다', async () => {
    const { client, calls } = fakeClient();
    expect((await loadOrderLineViews(client, [])).size).toBe(0);
    expect(calls.goods).toEqual([]);
  });

  it('이미 읽은 영수증이 있으면 다시 읽지 않고, v1(tryReceipt=false)도 영수증을 부르지 않는다', async () => {
    const { client, calls } = fakeClient();
    const given = (await loadOrderLineViews(client, [order({ tryReceipt: false, receipt: transactionDisplay })])).get(transactionOrder);
    expect(given?.[0]).toMatchObject({ purchaseAmount: 18000, regularAmount: 20000 });
    const v1 = (await loadOrderLineViews(client, [order({ tryReceipt: false })])).get(transactionOrder);
    expect(v1?.[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
    /* 영수증이 null로 주어지면(주문 상세 v1) 읽을 영수증이 없다는 뜻이다. */
    await loadOrderLineViews(client, [order({ receipt: null })]);
    expect(calls.receipts).toEqual([]);
  });

  it('굿즈 읽기가 오류여도 던지지 않고 스냅샷 이름·수량·단가의 줄을 돌려준다', async () => {
    const { client } = fakeClient({ goods: { data: null, error: { message: 'boom', code: '42501' } } });
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toMatchObject([{ name: '아크릴 스탠드', optionName: '파랑', qty: 2, ipName: null, thumbnail: null, adultMasked: false, purchaseAmount: 18000, regularAmount: 20000 }]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'goods:42501');
  });

  it('굿즈 읽기가 거절돼도(reject) 던지지 않는다', async () => {
    const { client } = fakeClient({ goods: () => { throw new Error('network'); } });
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toMatchObject([{ name: '아크릴 스탠드', thumbnail: null }]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'goods:unknown');
  });

  it('IP 읽기가 실패하면 IP명만 비고 썸네일·가격은 남는다', async () => {
    const { client } = fakeClient({ ips: { data: null, error: { message: 'boom', code: 'PGRST301' } } });
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toMatchObject([{ ipName: null, thumbnail: expect.stringContaining('goods/a.webp'), purchaseAmount: 18000 }]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'ips:PGRST301');
  });

  it('영수증 읽기가 실패하면 구매가 = 주문 단가 × 수량, 정가 없음으로 남는다', async () => {
    const { client } = fakeClient({ receipt: () => ({ data: null, error: { message: 'boom', code: '57014' } }) });
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toMatchObject([{ ipName: '홍실', purchaseAmount: 20000, regularAmount: null }]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'receipt:57014');
  });

  it('영수증 읽기가 거절돼도, 모양이 틀려도 던지지 않는다', async () => {
    const rejected = fakeClient({ receipt: () => { throw new Error('network'); } });
    expect((await loadOrderLineViews(rejected.client, [order()])).get(transactionOrder)?.[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
    const malformed = fakeClient({ receipt: () => ({ data: { nope: true }, error: null }) });
    expect((await loadOrderLineViews(malformed.client, [order()])).get(transactionOrder)?.[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
  });

  it('다른 주문의 영수증이 돌아오면 버린다', async () => {
    const { client } = fakeClient({ receipt: () => ({ data: { orderId: '72000000-0000-4000-8000-0000000000ff', quoteId: transactionQuoteId, display: transactionDisplay }, error: null }) });
    expect((await loadOrderLineViews(client, [order()])).get(transactionOrder)?.[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
  });

  it('성인 인증 확인이 실패하면 19금 굿즈를 가림 상태로 접는다', async () => {
    mocks.adult.mockRejectedValue(Object.assign(new Error('boom'), { code: 'X' }));
    const { client } = fakeClient({ goods: { data: [goodRow({ sale_restriction: 'adult' })], error: null } });
    const lines = (await loadOrderLineViews(client, [order()])).get(transactionOrder);
    expect(lines).toMatchObject([{ adultMasked: true, thumbnail: null, name: '아크릴 스탠드' }]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'adult:X');
  });

  it.each(['hidden', 'masked'] as const)('19금 굿즈는 성인 인증 전(%s)에 이미지를 비운다', async (access) => {
    mocks.adult.mockResolvedValue(access);
    const { client } = fakeClient({ goods: { data: [goodRow({ sale_restriction: 'adult' })], error: null } });
    expect((await loadOrderLineViews(client, [order()])).get(transactionOrder)?.[0]).toMatchObject({ adultMasked: true, thumbnail: null });
  });

  it('굿즈를 못 읽은 상태에서는 인증 전 회원에게 품목 자체 이미지 경로도 쓰지 않는다', async () => {
    mocks.adult.mockResolvedValue('masked');
    const { client } = fakeClient({ goods: { data: null, error: { message: 'boom', code: 'X' } } });
    const input = order({ tryReceipt: false, items: [{ ...order().items[0], imagePath: 'gift/own.webp' }] });
    expect((await loadOrderLineViews(client, [input])).get(transactionOrder)?.[0].thumbnail).toBeNull();
    /* 인증을 마친 회원은 그대로 쓴다. */
    mocks.adult.mockResolvedValue('full');
    expect((await loadOrderLineViews(client, [input])).get(transactionOrder)?.[0].thumbnail).toContain('gift/own.webp');
  });

  it('모든 보강이 실패해도 주문마다 스냅샷 줄이 남는다', async () => {
    mocks.adult.mockRejectedValue(new Error('adult'));
    const { client } = fakeClient({
      goods: { data: null, error: { message: 'a' } }, ips: { data: null, error: { message: 'b' } },
      receipt: () => ({ data: null, error: { message: 'c' } }),
    });
    const second = order({ orderId: 'order-2', tryReceipt: true });
    const result = await loadOrderLineViews(client, [order(), second]);
    expect(result.get(transactionOrder)).toHaveLength(1);
    expect(result.get('order-2')).toHaveLength(1);
    expect(result.get('order-2')?.[0]).toMatchObject({ name: '아크릴 스탠드', qty: 2, purchaseAmount: 20000, ipName: null, thumbnail: null });
  });

  it('영수증은 동시에 6개까지만 읽고 주문마다 한 번씩 읽는다', async () => {
    const { client, calls } = fakeClient();
    const orders = Array.from({ length: 14 }, (_, index) => order({ orderId: `order-${index}` }));
    /* 영수증 orderId가 주문과 달라 버려지지만, 호출 수·동시성이 이 테스트가 보는 것이다. */
    await loadOrderLineViews(client, orders);
    expect(calls.receipts).toHaveLength(14);
    expect(new Set(calls.receipts).size).toBe(14);
    expect(calls.maxActiveReceipts).toBeLessThanOrEqual(6);
    expect(calls.maxActiveReceipts).toBeGreaterThan(1);
  });

  it('굿즈 id는 1000개씩 나눠 읽고 같은 id는 한 번만 보낸다', async () => {
    const { client, calls } = fakeClient({ goods: { data: [], error: null } });
    const items = Array.from({ length: 1500 }, (_, index) => ({ key: `k${index}`, goodId: `good-${index}`, name: `굿즈 ${index}`, optionName: null, qty: 1, unitPrice: 100 }));
    await loadOrderLineViews(client, [{ orderId: 'big', tryReceipt: false, items: [...items, ...items.slice(0, 10)] }]);
    expect(calls.goods.map((ids) => ids.length)).toEqual([1000, 500]);
  });
});
