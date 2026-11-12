const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), query: [] as string[], result: { data: [] as unknown, error: null as unknown } }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from }) }));
import { readGoodsOptionStocksAction } from './goods-list-inline-actions';

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

describe('옵션별 재고 창의 현재 수량 다시 읽기 (1014-106)', () => {
  it('그 상품의 사용 옵션 실재고만 상품 수정의 옵션 순서로 읽고 쓰지 않는다', async () => {
    mocks.result = { data: [{ id: 'v1', name: '블루', code: 'B-1', stock_qty: 3 }, { id: 'v2', name: ' ', code: null, stock_qty: 0 }], error: null };
    expect(await readGoodsOptionStocksAction('good-a')).toEqual({ ok: true, options: [
      { variantId: 'v1', name: '블루', code: 'B-1', stockQty: 3 }, { variantId: 'v2', name: '이름 없는 옵션', code: '', stockQty: 0 },
    ] });
    expect(mocks.query).toEqual(['from:goods_variants', 'select:id,name,code,stock_qty', 'eq:good_id:good-a', 'is:archived_at:null', 'order:sort_order', 'order:id']);
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
