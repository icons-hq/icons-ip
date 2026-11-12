import { describe, expect, it } from 'vitest';
import {
  applyOptionStockOutcomes, applyOptionStockRead, discountStopApplied, discountStopAwaitingResult, discountStopSummary, openOptionStockRows, optionStockDefaultReason,
  optionStockNeedsRead, optionStockSummary, parseInlineSalePrice, parseInlineStockQty, planOptionStockSave, type GoodsListOptionStock, type OptionStockRow,
} from './goods-list-inline';

const options: GoodsListOptionStock[] = [
  { variantId: 'v-blue', name: '블루', code: 'OPT-B', stockQty: 5 },
  { variantId: 'v-red', name: '레드', code: 'OPT-R', stockQty: 4 },
  { variantId: 'v-green', name: '그린', code: 'OPT-G', stockQty: 3 },
];
let sequence = 0;
const newId = () => `req-${++sequence}`;
const edit = (rows: OptionStockRow[], variantId: string, patch: Partial<OptionStockRow>) => rows.map(row => row.variantId === variantId ? { ...row, ...patch } : row);

describe('옵션별 재고 창 규칙 (1014-106·107)', () => {
  it('수량은 0 이상 정수(쉼표 허용), 판매가는 1원 이상 정수만 받는다', () => {
    expect(parseInlineStockQty('1,200')).toBe(1200);
    expect(parseInlineStockQty('0')).toBe(0);
    for (const raw of ['', '-1', '1.5', '01', '2147483648', 'abc']) expect(parseInlineStockQty(raw)).toBeNull();
    expect(parseInlineSalePrice('12,000')).toBe(12000);
    for (const raw of ['0', '', '-100', '10.5', '2147483648']) expect(parseInlineSalePrice(raw)).toBeNull();
  });

  it('창을 연 때의 수량을 기대값으로, 바뀐 옵션만 보내고 사유를 비우면 바뀐 수량을 사유로 남긴다', () => {
    sequence = 0;
    let rows = openOptionStockRows(options, newId);
    expect(rows.map(row => [row.seen, row.input, row.status])).toEqual([[5, '5', 'idle'], [4, '4', 'idle'], [3, '3', 'idle']]);
    rows = edit(edit(rows, 'v-blue', { input: '8' }), 'v-green', { input: '0', reason: '  실사 반영  ' });
    const plan = planOptionStockSave(rows);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.requests).toEqual([
      { variantId: 'v-blue', requestId: 'req-1', expectedStockQty: 5, nextStockQty: 8, reason: optionStockDefaultReason(5, 8) },
      { variantId: 'v-green', requestId: 'req-3', expectedStockQty: 3, nextStockQty: 0, reason: '실사 반영' },
    ]);
    expect(optionStockDefaultReason(5, 1200)).toBe('상품 목록에서 옵션별 재고수량 수정 (5 → 1,200)');
  });

  it('잘못 입력한 옵션이 하나라도 있으면 아무것도 보내지 않고 그 줄에 이유를 붙이며, 고치면 이유를 지운다', () => {
    sequence = 0;
    const rows = edit(edit(openOptionStockRows(options, newId), 'v-blue', { input: '-3' }), 'v-red', { input: '9', reason: '가'.repeat(201) });
    const plan = planOptionStockSave(rows);
    expect(plan.ok).toBe(false);
    expect(plan.rows.map(row => [row.status, row.message])).toEqual([
      ['invalid', '0 이상의 정수로 입력해주세요.'], ['invalid', '사유는 200자 이하로 입력해주세요.'], ['idle', ''],
    ]);
    const fixed = planOptionStockSave(edit(edit(plan.rows, 'v-blue', { input: '6' }), 'v-red', { reason: '입고' }));
    expect(fixed.ok && fixed.requests.map(request => request.variantId)).toEqual(['v-blue', 'v-red']);
    expect(fixed.rows.every(row => row.status === 'idle' && row.message === '')).toBe(true);
    expect(planOptionStockSave(openOptionStockRows(options, newId))).toMatchObject({ ok: true, requests: [] });
  });

  it('다른 사람이 먼저 바꾼 옵션만 다시 확인이 되고, 그 상품을 새로 읽은 현재 수량을 보인 뒤에만 그 값을 기대값으로 다시 저장한다', () => {
    sequence = 0;
    const rows = edit(edit(edit(openOptionStockRows(options, newId), 'v-blue', { input: '8' }), 'v-red', { input: '9' }), 'v-green', { input: '1' });
    const next = applyOptionStockOutcomes(rows, [
      { variantId: 'v-blue', state: 'saved', stockQty: 8 },
      { variantId: 'v-red', state: 'rejected', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' },
      { variantId: 'v-green', state: 'uncertain', message: '저장 결과를 확인하지 못했습니다.' },
    ], newId);
    expect(next.map(row => [row.variantId, row.status, row.seen, row.input, row.requestId])).toEqual([
      ['v-blue', 'saved', 8, '8', 'req-4'], ['v-red', 'recheck', null, '9', 'req-5'], ['v-green', 'uncertain', 3, '1', 'req-3'],
    ]);
    // 새 현재 수량을 아직 못 읽은 줄은 보내지 않고, 저장 전에 먼저 읽어야 한다.
    expect(optionStockNeedsRead(next)).toBe(true);
    expect(planOptionStockSave(next).ok && (planOptionStockSave(next) as { requests: { variantId: string }[] }).requests.map(request => request.variantId)).toEqual(['v-green']);
    // 그 상품만 새로 읽어 빈 줄을 채운다. 이미 보고 있는 줄(저장됨·결과 확인 필요)의 기대값은 바꾸지 않는다.
    const read = applyOptionStockRead(next, options.map(option => option.variantId === 'v-red' ? { ...option, stockQty: 2 } : { ...option, stockQty: 99 }));
    expect(read.map(row => [row.seen, row.status, row.message])).toEqual([[8, 'saved', ''], [2, 'recheck', '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.'], [3, 'uncertain', '저장 결과를 확인하지 못했습니다.']]);
    expect(optionStockNeedsRead(read)).toBe(false);
    const retry = planOptionStockSave(read);
    expect(retry.ok && retry.requests).toEqual([
      { variantId: 'v-red', requestId: 'req-5', expectedStockQty: 2, nextStockQty: 9, reason: optionStockDefaultReason(2, 9) },
      // 결과를 모르는 줄은 같은 요청번호·같은 값으로 다시 보낸다(이미 반영됐으면 서버가 그 결과를 돌려준다).
      { variantId: 'v-green', requestId: 'req-3', expectedStockQty: 3, nextStockQty: 1, reason: optionStockDefaultReason(3, 1) },
    ]);
    // 새로 읽었는데 사용 중인 옵션에 없으면(보관 등) 그 줄만 남기고 보내지 않으며, 다시 읽기를 반복하지 않는다.
    const gone = applyOptionStockRead(next, options.filter(option => option.variantId !== 'v-red'));
    expect(gone[1]).toMatchObject({ seen: null, missing: true, status: 'recheck', message: expect.stringContaining('사용 중인 옵션에 없습니다') });
    expect(optionStockNeedsRead(gone)).toBe(false);
    const withoutRed = planOptionStockSave(gone);
    expect(withoutRed.ok && withoutRed.requests.map(request => request.variantId)).toEqual(['v-green']);
    expect(optionStockSummary([{ variantId: 'a', state: 'saved', stockQty: 1 }, { variantId: 'b', state: 'rejected', message: '' }]))
      .toBe('1개 옵션의 재고수량을 저장했습니다. 1개 옵션은 저장하지 않았습니다. 현재 수량을 다시 확인하고 저장해주세요.');
  });
});

describe('할인 중지 후 판매가 변경 규칙 (1027T-025)', () => {
  it('멈출 할인은 일괄 변경의 할인 중지 비교와 같은 글자로 보인다', () => {
    expect(discountStopSummary({ count: 2, minPrice: 8000, maxPrice: 8500, startsAt: '2026-11-12T01:00:00Z', endsAt: '2026-11-20T14:59:00Z' }))
      .toBe('할인 2건 · 할인가 8,000원 ~ 8,500원 · 11. 12. 10:00 ~ 11. 20. 23:59');
    expect(discountStopSummary({ count: 1, minPrice: 9000, maxPrice: 9000, startsAt: '2026-11-12T01:00:00Z', endsAt: '2026-11-13T01:00:00Z' })).toContain('할인가 9,000원 ·');
  });
  it('할인이 멈춘 뒤에는 닫을 때 목록을 새로 읽고, 결과를 모르는 동안은 닫지 않는다', () => {
    expect(discountStopApplied({ step: 'price', stoppedHere: true, stopped: null, error: 'x' })).toBe(true);
    expect(discountStopApplied({ step: 'ready', review: { operationId: 'op', discounts: null } })).toBe(false);
    expect(discountStopAwaitingResult({ step: 'stop-uncertain', review: { operationId: 'op', discounts: null }, operationId: 'op', message: '' })).toBe(true);
    expect(discountStopAwaitingResult({ step: 'price-uncertain', stoppedHere: true, stopped: null, operationId: 'op2', message: '' })).toBe(true);
    expect(discountStopAwaitingResult(null)).toBe(false);
  });
});
