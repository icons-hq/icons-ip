const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), from: vi.fn(), rpc: vi.fn(), query: [] as string[], result: { data: [] as unknown, error: null as unknown },
  revalidateGoods: vi.fn(), revalidatePath: vi.fn(), after: vi.fn(), restock: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.revalidateGoods }));
vi.mock('@/lib/email/transactional.server', () => ({ sendRestockAlertEmails: mocks.restock }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: mocks.after }));
import { adjustGoodsOptionStocksAction, readGoodsOptionStocksAction } from './goods-list-inline-actions';

const blue = 'b9000000-0000-4000-8000-0000000000a1', red = 'b9000000-0000-4000-8000-0000000000a2', green = 'b9000000-0000-4000-8000-0000000000a3';
const requests = [
  { variantId: blue, requestId: 'b9000000-0000-4000-8000-0000000000c1', expectedStockQty: 5, nextStockQty: 8, reason: '입고 반영' },
  { variantId: red, requestId: 'b9000000-0000-4000-8000-0000000000c2', expectedStockQty: 4, nextStockQty: 9, reason: '입고 반영' },
  { variantId: green, requestId: 'b9000000-0000-4000-8000-0000000000c3', expectedStockQty: 3, nextStockQty: 0, reason: '실사' },
];

beforeEach(() => {
  vi.clearAllMocks(); mocks.query = []; mocks.result = { data: [], error: null };
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() });
  mocks.from.mockImplementation((table: string) => {
    mocks.query.push(`from:${table}`);
    const builder = {
      select: (columns: string) => { mocks.query.push(`select:${columns}`); return builder; },
      eq: (column: string, value: unknown) => { mocks.query.push(`eq:${column}:${value}`); return builder; },
      is: (column: string, value: unknown) => { mocks.query.push(`is:${column}:${value}`); return builder; },
      order: (column: string) => { mocks.query.push(`order:${column}`); return builder; },
      limit: () => Promise.resolve(mocks.result),
    };
    return builder;
  });
});

describe('옵션별 재고 묶음 저장 (1014-106 — 옵션마다 기존 재고 조정, 화면 갱신 1회)', () => {
  it('옵션 3개 중 1개가 그사이 바뀌었으면 2개는 저장되고 1개는 거절(다시 확인)되며, 거절 옵션의 현재 수량을 함께 돌려주고 화면 갱신은 한 번만 한다', async () => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      order.push(String(args.target_variant_id));
      if (args.target_variant_id === red) return { data: null, error: { message: 'stock_changed' } };
      return { data: Number(args.target_expected_stock_qty) + Number(args.target_delta), error: null };
    });
    mocks.result = { data: [{ id: blue, name: '블루', code: 'B', stock_qty: 8 }, { id: red, name: '레드', code: 'R', stock_qty: 2 }, { id: green, name: '그린', code: 'G', stock_qty: 0 }], error: null };
    const result = await adjustGoodsOptionStocksAction('good-a', 'ip-a', requests);
    expect(result).toEqual({ ok: true, outcomes: [
      { variantId: blue, state: 'saved', stockQty: 8 },
      { variantId: red, state: 'rejected', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' },
      { variantId: green, state: 'saved', stockQty: 0 },
    ], options: [{ variantId: blue, name: '블루', code: 'B', stockQty: 8 }, { variantId: red, name: '레드', code: 'R', stockQty: 2 }, { variantId: green, name: '그린', code: 'G', stockQty: 0 }] });
    // 옵션마다 기존 재고 조정 RPC를 차례로(옵션별 트랜잭션·기대값·요청번호·사유 그대로) 부른다.
    expect(order).toEqual([blue, red, green]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_adjust_stock', { target_adjustment_id: 'b9000000-0000-4000-8000-0000000000c1', target_good_id: 'good-a', target_variant_id: blue,
      target_expected_stock_qty: 5, target_delta: 3, target_reason: '입고 반영' });
    expect(mocks.rpc.mock.calls[2][1]).toMatchObject({ target_expected_stock_qty: 3, target_delta: -3, target_reason: '실사' });
    // 화면 갱신·재입고 알림 예약은 묶음 끝에 한 번.
    expect(mocks.revalidateGoods).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/ip-a');
    expect(mocks.after).toHaveBeenCalledTimes(1);
    (mocks.after.mock.calls[0][0] as () => void)();
    expect(mocks.restock).toHaveBeenCalledWith('good-a');
  });
  it('모두 거절되면 재입고 알림은 예약하지 않고, 한 옵션의 응답이 끊겨도 나머지 옵션은 계속 조정한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'stock_changed' } })
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ data: null, error: { message: 'catalog_archived' } });
    const result = await adjustGoodsOptionStocksAction('good-a', null, requests);
    expect(result.ok && result.outcomes.map(outcome => outcome.state)).toEqual(['rejected', 'uncertain', 'rejected']);
    expect(result.ok && result.outcomes[2]).toMatchObject({ message: expect.stringContaining('보관된 상품') });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.revalidateGoods).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('입력이 하나라도 틀리면(요청번호·옵션·수량·사유·중복) 아무 옵션도 조정하지 않는다', async () => {
    const bad = [
      [{ ...requests[0], requestId: 'not-a-uuid' }],
      [{ ...requests[0], nextStockQty: 5 }],
      [{ ...requests[0], nextStockQty: -1 }],
      [{ ...requests[0], reason: ' ' }],
      [{ ...requests[0], reason: '가'.repeat(201) }],
      [requests[0], { ...requests[1], variantId: blue }],
      [{ ...requests[0], extra: true }],
      [],
    ];
    for (const value of bad) expect(await adjustGoodsOptionStocksAction('good-a', 'ip-a', value)).toMatchObject({ ok: false });
    expect(await adjustGoodsOptionStocksAction('Bad Id', 'ip-a', requests)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidateGoods).not.toHaveBeenCalled();
  });
  it('권한은 기존 재고 조정 액션과 같은 판정을 매 요청 서버에서 한다 — 미로그인은 로그인으로, 상품 관리 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, role: null, isStaff: false });
    await expect(adjustGoodsOptionStocksAction('good-a', 'ip-a', requests)).rejects.toMatchObject({ digest: expect.stringContaining(`/login?next=${encodeURIComponent('/admin')}`) });
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, role: 'user', isStaff: false });
    expect(await adjustGoodsOptionStocksAction('good-a', 'ip-a', requests)).toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('옵션별 재고 창의 현재 수량 다시 읽기 (1014-106)', () => {
  it('그 상품의 사용 옵션 실재고만 상품 수정의 옵션 순서로 읽고 쓰지 않는다', async () => {
    mocks.result = { data: [{ id: 'v1', name: '블루', code: 'B-1', stock_qty: 3 }, { id: 'v2', name: ' ', code: null, stock_qty: 0 }], error: null };
    expect(await readGoodsOptionStocksAction('good-a')).toEqual({ ok: true, options: [
      { variantId: 'v1', name: '블루', code: 'B-1', stockQty: 3 }, { variantId: 'v2', name: '이름 없는 옵션', code: '', stockQty: 0 },
    ] });
    expect(mocks.query).toEqual(['from:goods_variants', 'select:id,name,code,stock_qty', 'eq:good_id:good-a', 'is:archived_at:null', 'order:sort_order', 'order:id']);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('잘못된 상품·읽기 실패·이상한 수량은 오류로 돌려준다', async () => {
    expect(await readGoodsOptionStocksAction('Bad Id')).toMatchObject({ ok: false });
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.result = { data: null, error: { message: 'denied' } };
    expect(await readGoodsOptionStocksAction('good-a')).toMatchObject({ ok: false });
    mocks.result = { data: [{ id: 'v1', name: '블루', code: 'B', stock_qty: -1 }], error: null };
    expect(await readGoodsOptionStocksAction('good-a')).toMatchObject({ ok: false });
  });
  it('미로그인은 상품 목록으로 돌아오게 로그인으로 보내고, 상품 조회 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, role: null, isStaff: false });
    await expect(readGoodsOptionStocksAction('good-a')).rejects.toMatchObject({ digest: expect.stringContaining(`/login?next=${encodeURIComponent('/admin/catalog/goods')}`) });
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, role: 'user', isStaff: false });
    expect(await readGoodsOptionStocksAction('good-a')).toEqual({ ok: false, error: '상품을 조회할 권한이 필요합니다.' });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
