import { describe, expect, it, vi } from 'vitest';
import { MY_ORDER_ITEM_COLUMNS, mergeRandomOrderItemRows, readMyOrderItems } from './customer-items.server';

type Row = { id: string; order_id: string; option_sale_mode: 'select' | 'random' };

/** supabase-js rpc 빌더의 필요한 부분만 흉내 낸다. 마지막 체인 결과를 await한다. */
function client(pages: Array<{ data: Row[] | null; count: number | null; error: { message: string } | null }>) {
  const calls: Array<{ fn: string; args: unknown; options: unknown; select?: string; gt?: string; limit?: number }> = [];
  const rpc = vi.fn((fn: string, args: unknown, options: unknown) => {
    const call: (typeof calls)[number] = { fn, args, options };
    calls.push(call);
    const page = pages.shift() ?? { data: [], count: 0, error: null };
    const builder = {
      select(columns: string) { call.select = columns; return builder; },
      order() { return builder; },
      limit(size: number) { call.limit = size; return builder; },
      gt(_column: string, value: string) { call.gt = value; return builder; },
      then(resolve: (value: typeof page) => unknown) { return Promise.resolve(page).then(resolve); },
    };
    return builder;
  });
  return { client: { rpc }, calls };
}

describe('readMyOrderItems', () => {
  it('order_items를 직접 읽지 않고 마스킹 RPC를 id 커서로 끝까지 읽는다', async () => {
    const rows: Row[] = [
      { id: '00000000-0000-4000-8000-000000000001', order_id: 'order-1', option_sale_mode: 'random' },
      { id: '00000000-0000-4000-8000-000000000002', order_id: 'order-1', option_sale_mode: 'select' },
    ];
    const { client: supabase, calls } = client([
      { data: [rows[0]], count: 2, error: null },
      { data: [rows[1]], count: 1, error: null },
    ]);
    const result = await readMyOrderItems<Row>(supabase, ['order-1']);
    expect(result).toEqual({ data: rows, error: null });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ fn: 'my_order_items', args: { p_order_ids: ['order-1'] }, options: { count: 'exact' }, select: MY_ORDER_ITEM_COLUMNS });
    expect(calls[1].gt).toBe(rows[0].id);
  });

  it('주문이 없으면 부르지 않고, 오류·절단은 실패로 닫는다', async () => {
    const empty = client([]);
    expect(await readMyOrderItems(empty.client, [])).toEqual({ data: [], error: null });
    expect(empty.calls).toHaveLength(0);
    const failed = client([{ data: null, count: null, error: { message: 'permission denied' } }]);
    expect(await readMyOrderItems(failed.client, ['order-1'])).toEqual({ data: null, error: { message: 'permission denied' } });
    const truncated = client([{ data: [], count: 3, error: null }]);
    expect((await readMyOrderItems(truncated.client, ['order-1'])).data).toBeNull();
  });

  it('고른 열만 읽을 수 있다', async () => {
    const { client: supabase, calls } = client([{ data: [], count: 0, error: null }]);
    await readMyOrderItems(supabase, ['order-1'], 'id,good_id');
    expect(calls[0].select).toBe('id,good_id');
  });
});

describe('mergeRandomOrderItemRows', () => {
  const row = (id: string, goodId: string, qty: number, mode: 'select' | 'random', extra: Record<string, unknown> = {}) =>
    ({ id, order_id: 'order-1', good_id: goodId, qty, unit_price: 5000, option_sale_mode: mode, ...extra });

  it('같은 주문·굿즈의 랜덤 배정 행을 첫 행 하나로 합쳐 나뉜 개수를 보이지 않는다', () => {
    expect(mergeRandomOrderItemRows([
      row('a1', 'random-good', 2, 'random'), row('a2', 'plain', 1, 'select'), row('a3', 'random-good', 1, 'random'),
      row('a4', 'plain', 3, 'select'),
    ])).toEqual([row('a1', 'random-good', 3, 'random'), row('a2', 'plain', 1, 'select'), row('a4', 'plain', 3, 'select')]);
  });

  it('다른 주문·다른 단가의 랜덤 행은 합치지 않고, 선택 판매 행은 그대로 둔다', () => {
    const rows = [row('b1', 'g', 1, 'random'), { ...row('b2', 'g', 1, 'random'), order_id: 'order-2' },
      row('b3', 'g', 1, 'random', { unit_price: 4000 }), row('b4', 'h', 1, 'select'), row('b5', 'h', 1, 'select')];
    expect(mergeRandomOrderItemRows(rows)).toEqual(rows);
  });

  it('판정 함수를 바꿔 서비스 롤 행(option_sale_mode_snapshot)도 합친다', () => {
    const rows = [{ id: 'c1', good_id: 'g', qty: 1, option_sale_mode_snapshot: 'random' as const },
      { id: 'c2', good_id: 'g', qty: 4, option_sale_mode_snapshot: 'random' as const }];
    expect(mergeRandomOrderItemRows(rows, (item) => item.option_sale_mode_snapshot === 'random'))
      .toEqual([{ id: 'c1', good_id: 'g', qty: 5, option_sale_mode_snapshot: 'random' }]);
  });
});
