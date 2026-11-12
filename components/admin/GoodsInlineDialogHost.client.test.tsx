import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 목록 화면 수준의 창 주인(GoodsInlineDialogHost). 리뷰 재현(21 품절 필터·22 정렬 이동): 저장 뒤 목록이 다시 그려지며
 * 그 상품의 행이 현재 페이지에서 빠져도, 창과 그 결과(옵션별 '다시 확인'·'할인은 멈췄습니다')가 남아야 한다.
 * 여기서는 행(children)을 빼고 다시 그려도 창의 상태가 그대로인지 본다.
 */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, tasks: [] as Promise<unknown>[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useTransition: () => [false, (task: () => unknown) => { hooks.tasks.push(Promise.resolve(task())); }],
}));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn(), adjustBatch: vi.fn(), readOptions: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
vi.mock('@/app/admin/goods-list-inline-actions', () => ({ readGoodsOptionStocksAction: mocks.readOptions, adjustGoodsOptionStocksAction: mocks.adjustBatch }));

import { goodsBulkError, type GoodsBulkRequest } from '@/lib/admin/goods-bulk';
import { GoodsInlineDialogHost } from './GoodsInlineDialogHost';
import { GoodsDiscountStopPriceDialog, type DiscountStopPriceFlow } from './GoodsDiscountStopPriceDialog';
import { GoodsOptionStockDialog, type OptionStockDialogFlow } from './GoodsOptionStockDialog';

type Element = ReactElement<Record<string, unknown>>;
const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const discounts = { count: 1, minPrice: 9000, maxPrice: 9000, startsAt: '2026-11-13T01:00:00Z', endsAt: '2026-11-15T01:00:00Z' };
const row = <span data-row="good-a">상품 A 행</span>;

function render(children: ReactNode) {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = GoodsInlineDialogHost({ identity, children }) as Element;
  const parts = Children.toArray(tree.props.children as ReactNode).filter(isValidElement) as Element[];
  return {
    value: tree.props.value as { openOptionStock: (target: unknown) => void; openDiscountStop: (target: unknown) => void; notice: string },
    rows: parts.filter(part => part.props['data-row']),
    stock: parts.find(part => part.type === GoodsOptionStockDialog)?.props.flow as OptionStockDialogFlow,
    discount: parts.find(part => part.type === GoodsDiscountStopPriceDialog)?.props.flow as DiscountStopPriceFlow,
  };
}
async function settle() { while (hooks.tasks.length) await hooks.tasks.shift(); }

beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.refs = []; hooks.tasks = [];
  vi.stubGlobal('crypto', { randomUUID: (() => { let n = 0; return () => `b9000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() });
});

describe('목록 화면 수준의 창 (리뷰 21·22 — 상품이 현재 페이지에서 빠져도 결과가 남는다)', () => {
  it('옵션별 재고: 저장 뒤 그 상품의 행이 목록에서 빠져도 창과 옵션별 결과(저장됨·다시 확인)가 남고, 다시 확인 줄은 새로 읽은 수량을 보인다', async () => {
    // 서버 묶음 저장: 블루 저장, 레드는 그사이 바뀌어 거절 — 거절 옵션의 현재 수량(0)을 같은 응답에 돌려준다.
    mocks.adjustBatch.mockResolvedValue({ ok: true, outcomes: [{ variantId: 'v-blue', state: 'saved', stockQty: 8 }, { variantId: 'v-red', state: 'rejected', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' }],
      options: [{ variantId: 'v-blue', name: '블루', code: 'B', stockQty: 8 }, { variantId: 'v-red', name: '레드', code: 'R', stockQty: 0 }] });
    render(row).value.openOptionStock({ goodId: 'good-a', ipId: 'ip-a', goodName: '상품 A', goodCode: 'A', editorHref: '/admin/catalog/goods?goodId=good-a',
      options: [{ variantId: 'v-blue', name: '블루', code: 'B', stockQty: 5 }, { variantId: 'v-red', name: '레드', code: 'R', stockQty: 1 }] });
    let view = render(row);
    view.stock.change('v-blue', { input: '8' }); view.stock.change('v-red', { input: '9' });
    render(row).stock.save();
    await settle();
    // 품절 보기에서 재고를 채우면 그 상품은 목록에서 빠진다 — 행 없이 다시 그린다.
    view = render(null);
    expect(view.rows).toHaveLength(0);
    expect(view.stock.target?.goodId).toBe('good-a');
    expect(view.stock.rows?.map(item => [item.variantId, item.status, item.seen])).toEqual([['v-blue', 'saved', 8], ['v-red', 'recheck', 0]]);
    expect(view.stock.summary).toContain('1개 옵션은 저장하지 않았습니다');
    // 한 번의 서버 요청으로 보내고(화면 갱신은 서버가 한 번), 따로 다시 읽거나 화면을 또 새로 고치지 않는다.
    expect(mocks.adjustBatch).toHaveBeenCalledTimes(1);
    expect(mocks.readOptions).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('옵션별 재고: 모두 저장되면 창을 닫고 목록 위 결과 문구를 남긴다(그 상품이 목록에서 빠져도 결과가 보인다)', async () => {
    mocks.adjustBatch.mockResolvedValue({ ok: true, outcomes: [{ variantId: 'v-blue', state: 'saved', stockQty: 8 }] });
    render(row).value.openOptionStock({ goodId: 'good-a', ipId: 'ip-a', goodName: '상품 A', goodCode: 'A', editorHref: '/x', options: [{ variantId: 'v-blue', name: '블루', code: 'B', stockQty: 5 }, { variantId: 'v-red', name: '레드', code: 'R', stockQty: 1 }] });
    render(row).stock.change('v-blue', { input: '8' });
    render(row).stock.save();
    await settle();
    const view = render(null);
    expect(view.stock.rows).toBeNull();
    expect(view.value.notice).toBe('‘상품 A’ 옵션 1개의 재고수량을 저장했습니다.');
  });

  it('할인 중지 후 판매가 변경: 할인이 멈춰 그 상품이 정렬로 다른 페이지로 가도 창이 남아 "할인은 멈췄습니다"와 다시 시도를 보인다', async () => {
    mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ({ value: { state: 'ready', operationId, request, groups: [],
      goods: [{ id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 10000, priceMin: 10000, priceMax: 10000, nextMin: 10000, nextMax: 10000, published: true, archived: false, stopped: false,
        ...(request.command === 'discount_stop' ? { discounts } : {}) }], expiresAt: '2026-11-12T00:15:00Z' } }));
    const stopOperation = 'b9000000-0000-4000-8000-000000000001';
    mocks.commit.mockImplementation(async (operationId: string) => ({ value: operationId === stopOperation
      ? { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null }
      : { state: 'rejected', operationId, goodsCount: 0, groupsCount: 0, error: 'goods_bulk_busy' } }));
    render(row).value.openDiscountStop({ goodId: 'good-a', goodName: '상품 A', goodCode: 'A', basePrice: 10000, hasOptions: false });
    await settle();
    expect(render(row).discount.phase).toMatchObject({ step: 'ready', review: { operationId: stopOperation, discounts } });
    render(row).discount.setInput('12000');
    render(row).discount.submit();
    await settle();
    const view = render(null);
    expect(view.discount.target?.goodId).toBe('good-a');
    expect(view.discount.phase).toEqual({ step: 'price', stoppedHere: true, stopped: discounts, error: goodsBulkError('goods_bulk_busy') });
    expect(view.discount.committing).toBe(false);
    expect(view.value.notice).toBe('');
  });

  it('할인 중지 후 판매가 변경: 판매가 확정 응답이 끊기면 결과를 모르는 단계로 남아 닫히지 않는다', async () => {
    mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ({ value: { state: 'ready', operationId, request, groups: [],
      goods: [{ id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 10000, priceMin: 10000, priceMax: 10000, nextMin: 10000, nextMax: 10000, published: true, archived: false, stopped: false,
        ...(request.command === 'discount_stop' ? { discounts } : {}) }], expiresAt: '2026-11-12T00:15:00Z' } }));
    const stopOperation = 'b9000000-0000-4000-8000-000000000001';
    mocks.commit.mockImplementation(async (operationId: string) => operationId === stopOperation
      ? { value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null } } : Promise.reject(new Error('network')));
    render(row).value.openDiscountStop({ goodId: 'good-a', goodName: '상품 A', goodCode: 'A', basePrice: 10000, hasOptions: false });
    await settle();
    render(row).discount.setInput('12000');
    render(row).discount.submit();
    await settle();
    const view = render(null);
    expect(view.discount.phase).toMatchObject({ step: 'price-uncertain', stoppedHere: true, operationId: 'b9000000-0000-4000-8000-000000000002' });
    view.discount.close();
    expect(render(null).discount.phase).toMatchObject({ step: 'price-uncertain' });
    // 결과 조회가 완료를 확인하면 창을 닫고 결과 문구를 남긴다.
    mocks.read.mockResolvedValue({ value: { state: 'completed', operationId: 'b9000000-0000-4000-8000-000000000002', goodsCount: 1, groupsCount: 0, error: null } });
    render(null).discount.recover(false);
    await settle();
    const done = render(null);
    expect(done.discount.phase).toBeNull();
    expect(done.value.notice).toBe('‘상품 A’ 할인을 멈추고 판매가를 12,000원으로 바꿨습니다.');
  });
});
