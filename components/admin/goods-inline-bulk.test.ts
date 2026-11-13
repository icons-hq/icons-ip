import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn() }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
import { goodsBulkError, type GoodsBulkGood, type GoodsBulkRequest } from '@/lib/admin/goods-bulk';
import { changePriceAfterStop, recoverDiscountStopPrice, reviewDiscountStop, runSingleGoodBulk, stopDiscountThenChangePrice } from './goods-inline-bulk';

const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const discounts = { count: 2, minPrice: 8000, maxPrice: 8500, startsAt: '2026-11-12T01:00:00Z', endsAt: '2026-11-20T14:59:00Z' };
const good = (patch: Partial<GoodsBulkGood> = {}): GoodsBulkGood => ({ id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 10000, priceMin: 10000, priceMax: 12000,
  nextMin: 10000, nextMax: 12000, published: true, archived: false, stopped: false, ...patch });
const ready = (operationId: string, request: GoodsBulkRequest, row: GoodsBulkGood) => ({ value: { state: 'ready', operationId, request, groups: [], goods: [row], expiresAt: '2026-11-12T00:15:00Z' } });
const receipt = (operationId: string, state: string, error: string | null = null) => ({ value: { state, operationId, goodsCount: state === 'completed' ? 1 : 0, groupsCount: 0, error } });
const commands = () => mocks.preview.mock.calls.map(call => (call[1] as GoodsBulkRequest).command);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request,
    request.command === 'discount_stop' ? good({ discounts }) : good({ nextPrice: Number(request.values.value) })));
  mocks.commit.mockImplementation(async (operationId: string) => receipt(operationId, 'completed'));
  mocks.read.mockImplementation(async (operationId: string, _identity: unknown, seal: boolean) => receipt(operationId, seal ? 'sealed' : 'completed'));
});

describe('상품 1개짜리 일괄 변경', () => {
  it('확정 응답이 끊기면(호출 자체가 실패) 재실행하지 않고 같은 요청번호의 결과 조회를 남긴다', async () => {
    mocks.commit.mockRejectedValueOnce(new Error('network'));
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, () => null);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('불명확'), operationId: mocks.preview.mock.calls[0][0] });
  });
});

describe('할인 중지 후 판매가 변경 (1027T-025)', () => {
  it('창을 열면 멈출 할인만 읽고 아무것도 바꾸지 않는다', async () => {
    const phase = await reviewDiscountStop(identity, 'good-a', 10000);
    expect(phase).toEqual({ step: 'ready', review: { operationId: mocks.preview.mock.calls[0][0], discounts } });
    expect(mocks.preview).toHaveBeenCalledWith(expect.any(String), { kind: 'goods', ids: ['good-a'], command: 'discount_stop', values: {} }, identity);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  /* TKT-033: 기간 없는 즉시할인(정가 표시) 상품도 같은 창 — 운영자가 본 판매가는 할인 전 판매가이고, 그 즉시할인도 멈출 할인으로 보인다. */
  it('기간 없는 즉시할인 상품은 includeInstant로 멈출 할인을 읽고 할인 전 판매가로 비교하며, 멈춘 즉시할인을 다음 단계에 넘긴다', async () => {
    const instant = { regularPrice: 12000, salePrice: 9000 };
    mocks.preview.mockImplementationOnce(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, good({ price: 9000, discounts: null, instantDiscount: instant })));
    const phase = await reviewDiscountStop(identity, 'good-a', 12000, true);
    expect(mocks.preview.mock.calls[0][1]).toEqual({ kind: 'goods', ids: ['good-a'], command: 'discount_stop', values: { includeInstant: true } });
    expect(phase).toEqual({ step: 'ready', review: { operationId: mocks.preview.mock.calls[0][0], discounts: null, instant } });
    /* 할인 전 판매가가 그사이 바뀌었으면 닫는다(할인가가 아니라 할인 전 판매가로 견준다). */
    mocks.preview.mockImplementationOnce(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, good({ price: 9000, discounts: null, instantDiscount: { regularPrice: 13000, salePrice: 9000 } })));
    expect(await reviewDiscountStop(identity, 'good-a', 12000, true)).toEqual({ step: 'review-failed', retry: false, message: expect.stringContaining('13,000원') });
    /* 확정하면 멈춘 즉시할인을 판매가 단계에 넘기고, 판매가 변경의 기대값은 할인 전 판매가다. */
    vi.clearAllMocks();
    mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, good({ price: 12000, nextPrice: Number(request.values.value) })));
    mocks.commit.mockImplementation(async (operationId: string) => receipt(operationId, 'completed'));
    const onStopped = vi.fn();
    const step = await stopDiscountThenChangePrice(identity, 'good-a', { operationId: 'b9000000-0000-4000-8000-0000000000c1', discounts: null, instant }, 12000, 11000, onStopped);
    expect(step).toEqual({ phase: { step: 'price', stoppedHere: true, stopped: null, stoppedInstant: instant, error: '' }, done: true });
    expect(onStopped).toHaveBeenCalledWith({ step: 'price', stoppedHere: true, stopped: null, stoppedInstant: instant, error: '' });
  });

  it('목록에서 본 기본 판매가가 바뀌었으면 비교 요청을 닫고 새로고침을 요청한다', async () => {
    mocks.preview.mockImplementationOnce(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, good({ price: 11000, discounts })));
    const phase = await reviewDiscountStop(identity, 'good-a', 10000);
    expect(phase).toEqual({ step: 'review-failed', retry: false, message: expect.stringContaining('11,000원') });
    expect(mocks.read).toHaveBeenCalledWith(mocks.preview.mock.calls[0][0], identity, true);
  });

  it('멈출 할인이 그사이 없어졌으면 판매가만 바꾼다고 밝힌다', async () => {
    mocks.preview.mockResolvedValueOnce({ error: goodsBulkError('goods_bulk_no_active_discount') });
    expect(await reviewDiscountStop(identity, 'good-a', 10000)).toEqual({ step: 'price', stoppedHere: false, stopped: null, error: '' });
  });

  it('확인하면 기간 할인 중지 → 판매가 변경을 차례로 확정한다', async () => {
    const review = { operationId: 'b9000000-0000-4000-8000-0000000000a1', discounts };
    const onStopped = vi.fn();
    const step = await stopDiscountThenChangePrice(identity, 'good-a', review, 10000, 12000, onStopped);
    expect(step.done).toBe(true);
    expect(mocks.commit.mock.calls.map(call => call[0])).toEqual([review.operationId, mocks.preview.mock.calls[0][0]]);
    expect(commands()).toEqual(['price']);
    expect(mocks.preview.mock.calls[0][1]).toEqual({ kind: 'goods', ids: ['good-a'], command: 'price', values: { mode: 'set', value: 12000 } });
    expect(onStopped).toHaveBeenCalledWith({ step: 'price', stoppedHere: true, stopped: discounts, error: '' });
  });

  it('한 번에 진행하다 판매가 확정 응답이 끊기면 결과를 모르는 단계(price-uncertain)로 멈추고 그 요청번호를 남긴다', async () => {
    const review = { operationId: 'b9000000-0000-4000-8000-0000000000a1', discounts };
    // 할인 중지 확정은 받았고, 판매가 확정은 서버에 반영됐을 수 있으나 응답이 끊겼다(호출 실패·불명확 응답 두 경우).
    for (const failure of [() => Promise.reject(new Error('network')), () => Promise.resolve({ error: '처리 결과가 불명확합니다.', uncertain: true })]) {
      vi.clearAllMocks();
      mocks.commit.mockImplementation(async (operationId: string) => operationId === review.operationId ? receipt(operationId, 'completed') : failure());
      const onStopped = vi.fn();
      const step = await stopDiscountThenChangePrice(identity, 'good-a', review, 10000, 12000, onStopped);
      const priceOperation = mocks.preview.mock.calls[0][0];
      expect(step.done).toBeUndefined();
      expect(step.phase).toEqual({ step: 'price-uncertain', stoppedHere: true, stopped: discounts, operationId: priceOperation, message: expect.stringContaining('불명확') });
      expect(onStopped).toHaveBeenCalledWith({ step: 'price', stoppedHere: true, stopped: discounts, error: '' });
    }
    // 같은 단계에서 다시 시도해도 결과 단계는 넘겨받은 값이 아니라 결과로 정해진다.
    mocks.commit.mockResolvedValueOnce({ error: '처리 결과가 불명확합니다.', uncertain: true });
    const retried = await changePriceAfterStop(identity, 'good-a', 10000, 12000, { step: 'price', stoppedHere: true, stopped: discounts, error: 'x' } as never);
    expect(retried.phase).toMatchObject({ step: 'price-uncertain', stoppedHere: true });
    expect(Object.keys(retried.phase)).not.toContain('error');
  });

  it('판매가 변경이 실패하면 할인은 멈춘 채 두고(되돌리지 않음) 실패 사유와 함께 판매가만 다시 시도하게 한다', async () => {
    const review = { operationId: 'b9000000-0000-4000-8000-0000000000a1', discounts };
    mocks.commit.mockImplementation(async (operationId: string) => operationId === review.operationId ? receipt(operationId, 'completed') : receipt(operationId, 'rejected', 'goods_bulk_busy'));
    const step = await stopDiscountThenChangePrice(identity, 'good-a', review, 10000, 12000);
    expect(step).toEqual({ phase: { step: 'price', stoppedHere: true, stopped: discounts, error: goodsBulkError('goods_bulk_busy') } });
    // 할인 중지 확정은 한 번뿐이다. 다시 시도는 판매가만 새로 비교·확정한다.
    mocks.commit.mockImplementation(async (operationId: string) => receipt(operationId, 'completed'));
    const retry = await changePriceAfterStop(identity, 'good-a', 10000, 12000, { stoppedHere: true, stopped: discounts });
    expect(retry.done).toBe(true);
    expect(mocks.commit.mock.calls.filter(call => call[0] === review.operationId)).toHaveLength(1);
    expect(commands()).toEqual(['price', 'price']);
  });

  it('할인을 멈춘 사이 다른 곳에서 새 할인이 걸렸거나 기본 판매가가 바뀌었으면 판매가를 확정하지 않고 바뀐 값을 보인다', async () => {
    mocks.preview.mockResolvedValueOnce({ error: goodsBulkError('active_price_period_requires_reset') });
    const blocked = await changePriceAfterStop(identity, 'good-a', 10000, 12000, { stoppedHere: true, stopped: discounts });
    expect(blocked).toEqual({ phase: { step: 'price', stoppedHere: true, stopped: discounts, error: goodsBulkError('active_price_period_requires_reset') } });
    mocks.preview.mockImplementationOnce(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, good({ price: 9900 })));
    const stale = await changePriceAfterStop(identity, 'good-a', 10000, 12000, { stoppedHere: true, stopped: discounts });
    expect(stale).toEqual({ phase: { step: 'price', stoppedHere: true, stopped: discounts, error: expect.stringContaining('9,900원') }, seenBasePrice: 9900 });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith(mocks.preview.mock.calls[1][0], identity, true);
  });

  it('할인 중지가 거절되면 아무것도 바뀌지 않았다고 하고, 응답이 끊기면 판매가 변경으로 넘어가지 않는다', async () => {
    const review = { operationId: 'b9000000-0000-4000-8000-0000000000a1', discounts };
    mocks.commit.mockResolvedValueOnce(receipt(review.operationId, 'rejected', 'goods_bulk_changed'));
    expect(await stopDiscountThenChangePrice(identity, 'good-a', review, 10000, 12000)).toEqual({ phase: { step: 'review-failed', retry: true, message: goodsBulkError('goods_bulk_changed') } });
    mocks.commit.mockRejectedValueOnce(new Error('network'));
    const uncertain = await stopDiscountThenChangePrice(identity, 'good-a', review, 10000, 12000);
    expect(uncertain.phase).toMatchObject({ step: 'stop-uncertain', operationId: review.operationId });
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('결과 조회: 할인 중지가 확인되면 판매가 변경을 기다리고(자동으로 시작하지 않음), 미처리 종료면 아무것도 바뀌지 않았다고 한다', async () => {
    const review = { operationId: 'b9000000-0000-4000-8000-0000000000a1', discounts };
    const stopUncertain = { step: 'stop-uncertain' as const, review, operationId: review.operationId, message: '' };
    expect(await recoverDiscountStopPrice(identity, stopUncertain, false)).toEqual({ phase: { step: 'price', stoppedHere: true, stopped: discounts, error: '' } });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect((await recoverDiscountStopPrice(identity, stopUncertain, true)).phase).toMatchObject({ step: 'review-failed', retry: true, message: expect.stringContaining('바뀌지 않았습니다') });
    mocks.read.mockResolvedValueOnce(receipt(review.operationId, 'unresolved'));
    expect((await recoverDiscountStopPrice(identity, stopUncertain, false)).phase).toMatchObject({ step: 'stop-uncertain', message: expect.stringContaining('완료 기록') });
    const priceUncertain = { step: 'price-uncertain' as const, stoppedHere: true, stopped: discounts, operationId: 'b9000000-0000-4000-8000-0000000000b1', message: '' };
    expect((await recoverDiscountStopPrice(identity, priceUncertain, false)).done).toBe(true);
    expect((await recoverDiscountStopPrice(identity, priceUncertain, true)).phase).toEqual({ step: 'price', stoppedHere: true, stopped: discounts, error: expect.stringContaining('판매가는 바뀌지 않았습니다') });
  });
});
