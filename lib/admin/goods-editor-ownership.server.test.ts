import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ownership: vi.fn(), records: vi.fn() }));
vi.mock('./goods-group-common.server', () => ({ loadGoodsEditorOwnership: mocks.ownership }));
vi.mock('./catalog.server', () => ({ getAdminCatalogRecords: mocks.records }));
vi.mock('./category.server', () => ({ loadGoodsCategoryOptions: async () => [] }));
vi.mock('./shipping-notice-templates.server', () => ({ loadActiveShippingNoticeTemplateOptions: async () => [] }));
vi.mock('./fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: async () => [] }));
vi.mock('./goods-variants.server', () => ({ loadAdminGoodsVariants: async () => [] }));
vi.mock('./goods-readiness.server', () => ({ loadAdminGoodsReadiness: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async () => ({ data: [], error: null }), from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }));
import { loadAdminGoodEditor } from './goods-list.server';
import { parseGoodsEditorOwnership } from './goods-group-common';
import { commonTestOwnership } from './goods-group-common.test-fixtures';
const selected = { id: 'group-child', price: 12345, stockQty: 77, allowBankTransfer: false, allowCardPayment: true, saleRestriction: 'none', originId: null, shippingFeeType: 'individual', individualFee: 9999, minOrderQty: 1, maxOrderQty: 99 };
beforeEach(() => { vi.resetAllMocks(); mocks.ownership.mockResolvedValue(parseGoodsEditorOwnership(commonTestOwnership)); mocks.records.mockResolvedValue({ goods: [selected], ips: [] }); });
describe('개별 상품 편집기 합산 조건 표시', () => {
  it('하위 상품의 배송·수량 조건은 현재 원상품 값으로 읽고 가격·재고·결제는 보존한다', async () => {
    const editor = await loadAdminGoodEditor('group-child');
    expect(mocks.ownership).toHaveBeenCalledWith('group-child');
    expect(editor.records.goods[0]).toMatchObject({ ...selected, ...commonTestOwnership.aggregation.sharedPolicy });
    expect(editor.ownership).toMatchObject({ goodId: 'group-child', aggregation: { editable: false } });
  });
  it('신규 상품은 기존 상품의 소유권을 읽지 않는다', async () => { const editor = await loadAdminGoodEditor(); expect(editor.ownership).toBeNull(); expect(mocks.ownership).not.toHaveBeenCalled(); });
  it('소유권 확인 실패에서 개별 편집을 열지 않는다', async () => { mocks.ownership.mockRejectedValue(new Error('ownership unavailable')); await expect(loadAdminGoodEditor('group-child')).rejects.toThrow('ownership unavailable'); });
});
