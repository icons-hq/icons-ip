import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn(), adjust: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: mocks.adjust }));
import { GoodsInlinePrice, GoodsInlineSale, GoodsInlineStock, runSingleGoodBulk } from './GoodsInlineEdit';

const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const row = { id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 12000, priceMin: 10000, priceMax: 10000, nextMin: 12000, nextMax: 12000, published: true, archived: false, stopped: false, skip: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockImplementation(async (operationId: string, request: unknown) => ({ value: { state: 'ready', operationId, request, groups: [], goods: [row], expiresAt: '2026-10-27T00:15:00Z' } }));
  mocks.commit.mockImplementation(async (operationId: string) => ({ value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null } }));
  mocks.read.mockResolvedValue({ value: { state: 'sealed' } });
});

describe('상품 목록 바로 수정 (A9)', () => {
  it('목록에서 본 값과 현재 값이 같으면 기존 일괄 변경 경로로 상품 1개만 확정한다', async () => {
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, current => current.price === 10000 ? null : 'stale');
    expect(result).toEqual({ ok: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.any(String), { kind: 'goods', ids: ['good-a'], command: 'price', values: { mode: 'set', value: 12000 } }, identity);
    expect(mocks.commit).toHaveBeenCalledWith(mocks.preview.mock.calls[0][0], identity);
  });
  it('다른 곳에서 값이 바뀌었으면 확정하지 않고 요청을 종료한다', async () => {
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, current => current.price === 9000 ? null : '판매가가 바뀌었습니다.');
    expect(result).toEqual({ ok: false, message: '판매가가 바뀌었습니다.' });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith(mocks.preview.mock.calls[0][0], identity, true);
  });
  it('응답이 불확실하면 재실행 대신 같은 요청의 결과 조회를 남긴다', async () => {
    mocks.commit.mockResolvedValueOnce({ error: '처리 결과가 불명확합니다.', uncertain: true });
    const result = await runSingleGoodBulk(identity, 'good-a', 'stop', {}, () => null);
    expect(result).toEqual({ ok: false, message: '처리 결과가 불명확합니다.', operationId: mocks.preview.mock.calls[0][0] });
  });
  it('확정 거절은 운영자 문구로 옮긴다', async () => {
    mocks.commit.mockImplementationOnce(async (operationId: string) => ({ value: { state: 'rejected', operationId, goodsCount: 0, groupsCount: 0, error: 'goods_compare_at_price_invalid' } }));
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, () => null);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('정가') });
  });
  it('값 버튼은 셀 안에서 바로 수정을 연다', () => {
    const html = renderToStaticMarkup(<>
      <GoodsInlinePrice goodId="good-a" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />
      <GoodsInlineSale goodId="good-a" stopped identity={identity} />
      <GoodsInlineStock goodId="good-a" ipId="ip-a" variantId="b9000000-0000-4000-8000-000000000010" stockQty={7} />
    </>);
    for (const label of ['판매가 바로 수정', '판매상태 바로 수정', '재고수량 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('판매중지'); expect(html).toContain('7개');
  });
  it('판매가·재고수량은 셀 전체가 수정 버튼이고, 다른 링크와 함께 있는 판매상태는 그 줄을 채운다', () => {
    const cell = (markup: string) => /class="admin-goods-inline( admin-goods-inline--cell)?"/.exec(markup)?.[1] === ' admin-goods-inline--cell';
    expect(cell(renderToStaticMarkup(<GoodsInlinePrice goodId="good-a" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />))).toBe(true);
    expect(cell(renderToStaticMarkup(<GoodsInlineStock goodId="good-a" ipId="ip-a" variantId="b9000000-0000-4000-8000-000000000010" stockQty={7} />))).toBe(true);
    expect(cell(renderToStaticMarkup(<GoodsInlineSale goodId="good-a" stopped identity={identity} />))).toBe(false);
  });
});
