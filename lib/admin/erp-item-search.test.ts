import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from './erp-items';
import { createErpItemSearchScheduler, erpItemListPlacement, nextErpItemHighlight, type ErpItemSearchResponse } from './erp-item-search';

const item = (code: string, name = `${code} 품명`): ErpItemMatch => ({ code, name, category: null, salePrice: null, barcode: null, mappedCategoryId: null });

function deferred() {
  let resolve!: (value: ErpItemSearchResponse) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ErpItemSearchResponse>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ERP 품명 제안 검색 순서', () => {
  it('입력이 250ms 멈춘 뒤 한 번만 검색한다', async () => {
    const search = vi.fn(async () => ({ ok: true as const, items: [item('A')] }));
    const onResults = vi.fn();
    const scheduler = createErpItemSearchScheduler({ search, onResults });
    scheduler.request('키');
    scheduler.request('키링');
    scheduler.request('키링 ');
    await vi.advanceTimersByTimeAsync(249);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('키링');
    expect(onResults).toHaveBeenLastCalledWith([item('A')], '키링');
  });

  it('2자 미만이면 검색하지 않고 제안을 비운다', async () => {
    const search = vi.fn();
    const onResults = vi.fn();
    const scheduler = createErpItemSearchScheduler({ search, onResults });
    scheduler.request(' 키 ');
    await vi.runAllTimersAsync();
    expect(search).not.toHaveBeenCalled();
    expect(onResults).toHaveBeenCalledWith([], '키');
  });

  it('늦게 도착한 이전 검색 결과는 최신 결과를 덮지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onResults = vi.fn();
    const scheduler = createErpItemSearchScheduler({ search, onResults });
    scheduler.request('키링');
    await vi.advanceTimersByTimeAsync(250);
    scheduler.request('키링 거치대');
    await vi.advanceTimersByTimeAsync(250);
    second.resolve({ ok: true, items: [item('NEW')] });
    await vi.runAllTimersAsync();
    first.resolve({ ok: true, items: [item('OLD')] });
    await vi.runAllTimersAsync();
    expect(onResults.mock.calls).toEqual([[[item('NEW')], '키링 거치대']]);
  });

  it('선택·포커스 이탈 뒤 도착한 결과와 실패는 조용히 버리거나 비운다', async () => {
    const pending = deferred();
    const onResults = vi.fn();
    const scheduler = createErpItemSearchScheduler({ search: vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: false, error: 'x' }), onResults });
    scheduler.request('키링');
    await vi.advanceTimersByTimeAsync(250);
    scheduler.cancel();
    pending.resolve({ ok: true, items: [item('A')] });
    await vi.runAllTimersAsync();
    expect(onResults).not.toHaveBeenCalled();
    scheduler.request('키링');
    await vi.runAllTimersAsync();
    scheduler.request('키링2');
    await vi.runAllTimersAsync();
    expect(onResults.mock.calls).toEqual([[[], '키링'], [[], '키링2']]);
  });

  it('제안은 최대 8개로 자른다', async () => {
    const onResults = vi.fn();
    const scheduler = createErpItemSearchScheduler({ search: async () => ({ ok: true, items: Array.from({ length: 12 }, (_, index) => item(`C${index}`)) }), onResults });
    scheduler.request('품목');
    await vi.runAllTimersAsync();
    expect(onResults.mock.calls[0][0]).toHaveLength(8);
  });
});

describe('키보드 이동과 목록 위치', () => {
  it('↑↓로 순환한다', () => {
    expect(nextErpItemHighlight(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextErpItemHighlight(2, 3, 'ArrowDown')).toBe(0);
    expect(nextErpItemHighlight(-1, 3, 'ArrowUp')).toBe(2);
    expect(nextErpItemHighlight(1, 3, 'ArrowUp')).toBe(0);
    expect(nextErpItemHighlight(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('가로 스크롤 표 안에서도 화면 기준으로 열고, 아래가 좁으면 위로 연다', () => {
    expect(erpItemListPlacement({ top: 100, bottom: 140, left: 20, width: 180 }, { width: 1280, height: 800 }))
      .toEqual({ top: 144, left: 20, width: 280, maxHeight: 320 });
    expect(erpItemListPlacement({ top: 700, bottom: 740, left: 1200, width: 180 }, { width: 1280, height: 800 }))
      .toEqual({ bottom: 104, left: 992, width: 280, maxHeight: 320 });
    expect(erpItemListPlacement({ top: 100, bottom: 140, left: 10, width: 400 }, { width: 320, height: 800 }))
      .toMatchObject({ left: 8, width: 304 });
  });
});
