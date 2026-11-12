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
