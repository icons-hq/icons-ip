import { describe, expect, it } from 'vitest';
import {
  emptyPreorderPlan, expandPreorderPlan, preorderPlanUsesOwnSchedules, preorderSellableStock, fillPreorderPlanCapacity, firstPreorderPlanProblemField, parseAdminPreorderReservations, parseGoodsPreorderBulkRequest, parseGoodsPreorderInput,
  parseRandomPreorderRequest, pendingPreorderReservationsByVariant, preorderApplyProblemLabels, preorderApplyProblems, preorderBulkSavedMessage,
  preorderCapacityFromStock, preorderCapacityProblem, preorderCapacityStockNote, preorderEditorTargets, preorderMutationError, preorderOptionNames, preorderPlanHasInput,
  preorderPlanManualCapacities, preorderPlanOwnSchedules, preorderPlanProblemMessage, preorderPlanProblems, preorderPlanReadback, preparePreorderAllocation, setPreorderPlanPerOption,
  type PreorderPlan, type PreorderPlanTarget,
} from './goods-preorders';
describe('preorder operation inputs', () => {
  /* 2026-11-19: 임시저장(초안)·승인 근거는 없다. 저장 = 적용이고 물량·접수 기간·발송 예정일만 있으면 된다. */
  it('rejects drafts, needs only quantity and promised dates to save, and keeps an optional note', () => {
    expect(parseGoodsPreorderInput({ state: 'draft', capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' })).toBeNull();
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01' }))
      .toMatchObject({ state: 'active', capacityQty: 50, approvalReference: null });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01', approvalReference: ' 일정 변경 메모 ' }))
      .toMatchObject({ approvalReference: '일정 변경 메모' });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '', startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01' })).toBeNull();
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '0' })).toBeNull();
  });
  it('interprets operator wall times in Korea and refuses an earlier promised date', () => {
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '50', startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01', approvalReference: '공급 승인 1' }))
      .toMatchObject({ capacityQty: 50, startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-09-14', approvalReference: '공급 승인 1' })).toBeNull();
  });
  it('requires every selected order item and one consistent physical-stock observation per option', () => {
    const rows = [
      { orderItemId: '00000000-0000-4000-8000-000000000001', variantId: '00000000-0000-4000-8000-000000000003', physicalStockQty: 3 },
      { orderItemId: '00000000-0000-4000-8000-000000000002', variantId: '00000000-0000-4000-8000-000000000003', physicalStockQty: 3 },
    ];
    expect(preparePreorderAllocation(rows, rows.map((row) => row.orderItemId))).toEqual({
      orderItemIds: rows.map((row) => row.orderItemId), expectedStock: { '00000000-0000-4000-8000-000000000003': 3 },
    });
    expect(preparePreorderAllocation(rows, ['00000000-0000-4000-8000-000000000004'])).toBeNull();
    expect(preparePreorderAllocation([rows[0], { ...rows[1], physicalStockQty: 5 }], rows.map((row) => row.orderItemId))).toBeNull();
  });
});

describe('일반 재고 전환을 막는 미할당 예약', () => {
  it('옵션마다 모든 예약 조건(이전 회차의 중지된 조건 포함)의 미할당 수량을 합하고, 남은 옵션만 돌려준다', () => {
    const pending = pendingPreorderReservationsByVariant([
      { variantId: 'red', reservedQty: 0 }, { variantId: 'red', reservedQty: 2 }, { variantId: 'red', reservedQty: 1 },
      { variantId: 'blue', reservedQty: 0 },
    ]);
    expect([...pending]).toEqual([['red', 3]]);
    expect(pendingPreorderReservationsByVariant([]).size).toBe(0);
  });
});

describe('랜덤 판매 일괄 예약 입력', () => {
  const a = '00000000-0000-4000-8000-0000000000a1';
  const b = '00000000-0000-4000-8000-0000000000b1';
  const selected = '00000000-0000-4000-8000-0000000000d1';
  const values = { startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20' };
  it('공통 일정은 한 번, 예약 물량은 옵션별로 읽는다(저장 = 적용, 근거 없이)', () => {
    expect(parseRandomPreorderRequest('active', values, [
      { variantId: a, policyId: null, expectedRevision: null, capacityQty: '30' },
      { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 },
    ])).toEqual({
      state: 'active',
      values: { startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20', approvalReference: null },
      options: [
        { variantId: a, policyId: null, expectedRevision: null, capacityQty: 30 },
        { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 },
      ],
    });
  });
  it('저장은 모든 옵션 물량과 공통 일정이 있어야 하고, 초안·기존 정책 이어 쓰기는 없다', () => {
    const options = [{ variantId: a, policyId: null, expectedRevision: null, capacityQty: 30 }, { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 }];
    expect(parseRandomPreorderRequest('active', values, options)?.options.map((option) => option.capacityQty)).toEqual([30, 20]);
    expect(parseRandomPreorderRequest('active', values, [options[0], { ...options[1], capacityQty: '' }])).toBeNull();
    expect(parseRandomPreorderRequest('active', { ...values, expectedShipDate: '2099-11-01' }, options)).toBeNull();
    expect(parseRandomPreorderRequest('active', values, [{ ...options[0], policyId: selected, expectedRevision: 1 }])).toBeNull();
    expect(parseRandomPreorderRequest('draft', values, options)).toBeNull();
  });
  it('중지·일반 재고 전환은 옵션마다 선택된 정책과 revision만 보낸다', () => {
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: 2 }]))
      .toEqual({ state: 'stopped', values: null, options: [{ variantId: a, policyId: selected, expectedRevision: 2 }] });
    expect(parseRandomPreorderRequest('stock', null, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', values, [{ variantId: a, policyId: selected, expectedRevision: 2 }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: 2, capacityQty: 1 }])).toBeNull();
  });
  it('중복 옵션·짝이 맞지 않는 정책·잘못된 상태는 거절한다', () => {
    expect(parseRandomPreorderRequest('active', values, [{ variantId: a, policyId: null, expectedRevision: null, capacityQty: 1 }, { variantId: a, policyId: null, expectedRevision: null, capacityQty: 1 }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('open', values, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('active', values, [])).toBeNull();
  });
  it('일괄 저장 거절 코드를 운영자 문구로 옮긴다', () => {
    expect(preorderMutationError('random_preorder_options_mismatch')).toContain('새로고침');
    expect(preorderMutationError('random_option_preorder_mismatch')).toContain('발송 예정일');
  });
});

describe('출고 보류 예약 주문 표시', () => {
  const row = { orderItemId: '10000000-0000-4000-8000-000000000001', orderId: '20000000-0000-4000-8000-000000000001', policyId: '30000000-0000-4000-8000-000000000001',
    variantId: '40000000-0000-4000-8000-000000000001', variantName: null, qty: 1, physicalStockQty: 3, state: 'reserved', orderStatus: 'paid',
    expectedShipDate: '2026-12-02', createdAt: '2026-11-18T00:00:00Z', allocatedAt: null, allocationReference: null, releasedAt: null, releaseReason: null };
  it('보류 여부를 읽고(옛 응답은 없음) 형식이 틀리면 거절한다', () => {
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [{ ...row, fulfillmentHold: true }] })?.items[0].fulfillmentHold).toBe(true);
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [row] })?.items[0].fulfillmentHold).toBeUndefined();
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [{ ...row, fulfillmentHold: 'yes' }] })).toBeNull();
    expect(preorderMutationError('order fulfillment hold')).toContain('출고 보류');
  });
});

/* 2026-11-19: 예약판매는 저장하면 적용된다. 저장할 때 빈 칸·DB가 거절할 값은 칸마다 이유를 보이고 막는다(승인 근거 칸은 없다). */
describe('예약판매 저장 전 칸별 확인', () => {
  const now = Date.parse('2026-11-19T05:00:00.000Z'); // 2026-11-19 14:00 KST
  const filled = { capacityQty: '300', startsAt: '2026-11-20T10:00', endsAt: '2026-12-01T23:59', expectedShipDate: '2026-12-10' };
  it('빈 칸은 칸마다 이유를 돌려주고, 이름은 화면 순서로 잇는다', () => {
    const problems = preorderApplyProblems({ capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '' }, now);
    expect(Object.keys(problems)).toEqual(['capacityQty', 'startsAt', 'endsAt', 'expectedShipDate']);
    expect(problems.capacityQty).toBe('예약 물량을 입력해주세요.');
    expect(preorderApplyProblemLabels(problems)).toBe('예약 물량·접수 시작·접수 종료·발송 예정일');
    /* 사고 그대로(물량·접수 종료가 빈 초안): 이제 저장 자체가 막히고 두 칸을 알린다. */
    expect(preorderApplyProblemLabels(preorderApplyProblems({ ...filled, capacityQty: '', endsAt: '' }, now))).toBe('예약 물량·접수 종료');
  });
  it('모두 맞으면 빈 객체이고, DB와 같은 순서·시각 규칙을 미리 막는다', () => {
    expect(preorderApplyProblems(filled, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, capacityQty: '0' }, now).capacityQty).toContain('1 이상의 정수');
    expect(preorderApplyProblems({ ...filled, endsAt: '2026-11-20T09:00' }, now).endsAt).toContain('접수 시작보다 뒤');
    expect(preorderApplyProblems({ ...filled, startsAt: '2026-11-01T10:00', endsAt: '2026-11-19T13:59' }, now).endsAt).toContain('지금보다 뒤');
    /* 발송 예정일은 접수 종료일(KST) 이상이다 — 12/1 23:59 KST 종료면 12/1은 되고 11/30은 안 된다. */
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-12-01' }, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-11-30' }, now).expectedShipDate).toContain('접수 종료일과 같거나 뒤');
  });
  it('랜덤 판매의 공통 칸 확인은 물량을 빼고, 옵션별 물량은 따로 본다', () => {
    const { capacityQty, ...common } = filled; void capacityQty;
    expect(preorderApplyProblems(common, now)).toEqual({});
    expect(preorderCapacityProblem('')).toBe('예약 물량을 입력해주세요.');
    expect(preorderCapacityProblem('1.5')).toContain('정수');
    expect(preorderCapacityProblem(' 20 ')).toBeNull();
  });
});

/* 11/19 "예약상품도 그냥 재고수량 미리 입력할 수 있게" — 예약 물량 기본값은 옵션 재고수량이고, 다르면 경고만 한다. */
describe('예약 물량 = 재고수량', () => {
  it('재고수량이 1 이상이면 그 수를, 0·미입력이면 빈 값을 기본 물량으로 쓴다', () => {
    expect(preorderCapacityFromStock(500)).toBe('500');
    for (const stock of [0, -1, Number.NaN, 1.5, null, undefined]) expect(preorderCapacityFromStock(stock)).toBe('');
  });
  it('물량이 재고수량과 같으면 안내가 없고, 다르면 입고 때 맞추라고 안내한다(막지 않는다)', () => {
    expect(preorderCapacityStockNote('500', 500)).toBeNull();
    expect(preorderCapacityStockNote('', 500)).toBeNull();
    expect(preorderCapacityStockNote('300', 500)).toContain('재고수량 500개와 다릅니다');
    /* 재고 0에서 입고 때 더하는 기존 흐름. */
    expect(preorderCapacityStockNote('300', 0)).toContain('재고 조정으로 들어온 수량을 더한 뒤');
    expect(preorderCapacityStockNote('300', Number.NaN)).toContain('재고수량이 0입니다');
  });
});

/* 화면 규칙 6(2026-11-25): 여러 옵션에 같은 일정은 한 번에 넣는다. 일정은 한 번, 예약 물량은 옵션별이고 옵션마다 다른 일정은 필요할 때만 펼친다. */
describe('예약판매 한 번에 입력', () => {
  const targets: PreorderPlanTarget[] = [{ key: 'red', name: '빨강', stockQty: 500 }, { key: 'blue', name: '파랑', stockQty: 300 }, { key: 'green', name: '초록', stockQty: 0 }];
  const schedule = { startsAt: '2099-12-01T10:00', endsAt: '2099-12-07T23:59', expectedShipDate: '2099-12-20' };
  const plan: PreorderPlan = { ...emptyPreorderPlan(), ...schedule };
  const now = Date.parse('2099-11-25T00:00:00+09:00');

  it('일정 한 번을 모든 옵션의 조건으로 펼치고, 물량은 고치지 않은 옵션만 재고수량을 따라간다', () => {
    expect(expandPreorderPlan(plan, targets)).toEqual([
      { key: 'red', name: '빨강', capacityQty: '500', capacityFromStock: true, ...schedule },
      { key: 'blue', name: '파랑', capacityQty: '300', capacityFromStock: true, ...schedule },
      { key: 'green', name: '초록', capacityQty: '', capacityFromStock: true, ...schedule },
    ]);
    /* 체크를 끈 옵션은 빠지고(일부 옵션만 예약), 직접 고친 물량은 재고수량과 달라도 그 값을 쓴다. */
    const partial = expandPreorderPlan({ ...plan, options: { blue: { excluded: true }, green: { capacityQty: '40' } } }, targets);
    expect(partial.map((entry) => [entry.key, entry.capacityQty, entry.capacityFromStock])).toEqual([['red', '500', true], ['green', '40', false]]);
    /* 옵션 30개도 일정 입력은 한 번이다. */
    const many = Array.from({ length: 30 }, (_, index) => ({ key: `v${index}`, name: `옵션 ${index + 1}`, stockQty: 10 }));
    const expanded = expandPreorderPlan(plan, many);
    expect(expanded).toHaveLength(30);
    expect(new Set(expanded.map((entry) => `${entry.startsAt}|${entry.endsAt}|${entry.expectedShipDate}`)).size).toBe(1);
  });

  it('옵션마다 일정을 다르게 넣으면 고친 옵션만 자기 일정을 쓰고, 랜덤 판매(모든 옵션)는 빼둔 옵션·옵션별 일정을 무시한다', () => {
    const own: PreorderPlan = { ...plan, perOption: true, options: { blue: { expectedShipDate: '2099-12-28' }, green: { excluded: true } } };
    expect(expandPreorderPlan(own, targets).map((entry) => [entry.key, entry.expectedShipDate])).toEqual([['red', '2099-12-20'], ['blue', '2099-12-28']]);
    expect(expandPreorderPlan(own, targets, { all: true }).map((entry) => [entry.key, entry.expectedShipDate]))
      .toEqual([['red', '2099-12-20'], ['blue', '2099-12-20'], ['green', '2099-12-20']]);
    /* 끄기 전에 사라지는 옵션별 일정 수를 알리고(규칙 7), 끄면 물량·체크는 남기고 일정만 지운다. */
    expect(preorderPlanOwnSchedules(own, targets)).toBe(1);
    expect(setPreorderPlanPerOption({ ...own, options: { ...own.options, red: { capacityQty: '10', startsAt: schedule.startsAt } } }, false))
      .toEqual({ ...plan, perOption: false, options: { red: { capacityQty: '10' }, green: { excluded: true } } });
    expect(setPreorderPlanPerOption(plan, true).perOption).toBe(true);
  });

  it('[전체 같은 수량 넣기]·[재고수량과 같게]는 예약하는 옵션의 물량만 채우고, 바뀌는 직접 입력 수를 먼저 센다', () => {
    const typed: PreorderPlan = { ...plan, options: { red: { capacityQty: '120' }, blue: { excluded: true, capacityQty: '7' } } };
    expect(preorderPlanManualCapacities(typed, targets, '100')).toBe(1);
    expect(preorderPlanManualCapacities(typed, targets, '120')).toBe(0);
    expect(preorderPlanManualCapacities(typed, targets, null)).toBe(1);
    expect(preorderPlanManualCapacities({ ...plan, options: { red: { capacityQty: '500' } } }, targets, null)).toBe(0);
    const filled = fillPreorderPlanCapacity(typed, targets, '100');
    expect(expandPreorderPlan(filled, targets).map((entry) => [entry.key, entry.capacityQty])).toEqual([['red', '100'], ['green', '100']]);
    /* 빼둔 옵션은 건드리지 않는다. */
    expect(filled.options.blue).toEqual({ excluded: true, capacityQty: '7' });
    const followed = fillPreorderPlanCapacity(filled, targets, null);
    expect(expandPreorderPlan(followed, targets).map((entry) => [entry.key, entry.capacityQty, entry.capacityFromStock])).toEqual([['red', '500', true], ['green', '', true]]);
    expect(followed.options).toEqual({ blue: { excluded: true, capacityQty: '7' } });
  });

  it('다시 입력해야 하는 값이 있을 때만 버리기 전에 묻는다', () => {
    expect(preorderPlanHasInput(emptyPreorderPlan())).toBe(false);
    expect(preorderPlanHasInput({ ...emptyPreorderPlan(), options: { red: { excluded: false } } })).toBe(false);
    for (const typed of [{ ...emptyPreorderPlan(), endsAt: schedule.endsAt }, { ...emptyPreorderPlan(), options: { red: { capacityQty: '' } } },
      { ...emptyPreorderPlan(), options: { red: { excluded: true } } }, { ...emptyPreorderPlan(), options: { red: { expectedShipDate: '2099-12-28' } } }]) {
      expect(preorderPlanHasInput(typed)).toBe(true);
    }
  });

  it('저장 전에 빈 칸을 화면 순서대로 모아 알리고, 막힌 첫 칸을 가리킨다', () => {
    const blank = preorderPlanProblems({ ...emptyPreorderPlan(), startsAt: schedule.startsAt }, targets, { now });
    expect(blank.common).toEqual({ endsAt: '접수 종료 일시를 입력해주세요.', expectedShipDate: '발송 예정일을 입력해주세요.' });
    expect(blank.options).toEqual({ green: { capacityQty: '예약 물량을 입력해주세요.' } });
    expect(preorderPlanProblemMessage(blank)).toBe('접수 종료·발송 예정일·옵션별 예약 물량 칸을 확인해주세요.');
    expect(firstPreorderPlanProblemField(blank, targets)).toBe('endsAt');
    const capacityOnly = preorderPlanProblems(plan, targets, { now });
    expect(preorderPlanProblemMessage(capacityOnly)).toBe('옵션별 예약 물량 칸을 확인해주세요.');
    expect(firstPreorderPlanProblemField(capacityOnly, targets)).toBe('capacity:green');
    /* 옵션이 하나뿐인 화면은 옵션 표가 없다: 칸 이름에 '옵션별'을 붙이지 않고 물량 칸을 먼저 가리킨다. */
    const single = preorderPlanProblems({ ...emptyPreorderPlan() }, [targets[2]], { now });
    expect(preorderPlanProblemMessage(single, { table: false })).toBe('예약 물량·접수 시작·접수 종료·발송 예정일 칸을 확인해주세요.');
    expect(firstPreorderPlanProblemField(single, [targets[2]], { table: false })).toBe('capacityQty');
    /* 옵션마다 일정을 다르게: 일정 문제도 옵션 줄에 붙는다. */
    const own = preorderPlanProblems({ ...plan, perOption: true, options: { green: { capacityQty: '5', endsAt: '2099-11-30T00:00' } } }, targets, { now });
    expect(own.common).toEqual({});
    expect(own.options).toEqual({ green: { endsAt: '접수 종료는 접수 시작보다 뒤여야 합니다.' } });
    expect(preorderPlanProblemMessage(own)).toBe('옵션별 접수 종료 칸을 확인해주세요.');
    expect(firstPreorderPlanProblemField(own, targets)).toBe('endsAt:green');
    const none = preorderPlanProblems({ ...plan, options: { red: { excluded: true }, blue: { excluded: true }, green: { excluded: true } } }, targets, { now });
    expect(preorderPlanProblemMessage(none)).toBe('예약할 옵션을 하나 이상 체크해주세요.');
    expect(preorderPlanProblemMessage(preorderPlanProblems({ ...plan, options: { green: { capacityQty: '20' } } }, targets, { now }))).toBeNull();
  });

  /* '글보다 화면' 3: 입력 방법을 글로 설명하지 않고 지금 값을 한 줄로 되읽는다. */
  it('입력을 한 줄로 되읽고, 덜 채웠으면 채운 만큼만, 순서가 틀리면 그 자리에서 말한다', () => {
    const ready: PreorderPlan = { ...plan, options: { green: { capacityQty: '400' } } };
    expect(preorderPlanReadback(ready, targets, { now })).toEqual({ problem: false, text: '12월 1일 10:00부터 7일 23:59까지 주문받고 12월 20일에 보냅니다. 옵션 3개 · 예약 물량 합계 1,200개.' });
    /* 올해가 아닌 날짜는 연도를 붙이고, 달이 바뀌면 끝에도 달을 적는다. */
    const nextYear = { ...ready, endsAt: '2100-01-05T23:59', expectedShipDate: '2100-01-20' };
    expect(preorderPlanReadback(nextYear, targets, { now })?.text).toBe('12월 1일 10:00부터 2100년 1월 5일 23:59까지 주문받고 2100년 1월 20일에 보냅니다. 옵션 3개 · 예약 물량 합계 1,200개.');
    expect(preorderPlanReadback({ ...emptyPreorderPlan(), startsAt: schedule.startsAt }, targets, { now })?.text).toBe('12월 1일 10:00부터 주문받습니다. 옵션 3개 중 1개는 예약 물량이 비어 있습니다.');
    expect(preorderPlanReadback({ ...emptyPreorderPlan(), expectedShipDate: schedule.expectedShipDate }, [targets[0]], { now, table: false })?.text).toBe('12월 20일에 보냅니다. 예약 물량 500개.');
    expect(preorderPlanReadback({ ...ready, endsAt: '2099-11-30T10:00' }, targets, { now })).toEqual({ problem: true, text: '접수 종료가 접수 시작보다 앞입니다. 날짜를 다시 확인해주세요.' });
    expect(preorderPlanReadback({ ...ready, expectedShipDate: '2099-12-06' }, targets, { now })).toEqual({ problem: true, text: '발송 예정일이 접수 종료일보다 앞입니다. 날짜를 다시 확인해주세요.' });
    expect(preorderPlanReadback(ready, targets, { now: Date.parse('2099-12-08T00:00:00+09:00') })).toEqual({ problem: true, text: '접수 종료가 이미 지났습니다. 날짜를 다시 확인해주세요.' });
    expect(preorderPlanReadback({ ...ready, perOption: true }, targets, { now })?.text).toBe('옵션마다 다른 일정으로 주문받습니다. 옵션 3개 · 예약 물량 합계 1,200개.');
    expect(preorderPlanReadback(emptyPreorderPlan(), [], { now })).toBeNull();
  });
});

/* 과판매 방지: 이미 예약판매 중인 옵션을 중지하고 새로 만들면 남은 예약 물량이 처음부터 다시 계산된다. 일괄 저장은 그 옵션을 건너뛴다. */
describe('일괄 저장과 이미 예약판매 중인 옵션', () => {
  const red = '00000000-0000-4000-8000-000000000001', blue = '00000000-0000-4000-8000-000000000002', gray = '00000000-0000-4000-8000-000000000003';
  const values = { capacityQty: '50', startsAt: '2099-12-01T10:00', endsAt: '2099-12-07T23:59', expectedShipDate: '2099-12-20' };

  it('화면은 이미 적용 중인 옵션과 사용 중지 옵션을 새 예약 표에서 뺀다(접수가 끝났어도 중지 전이면 그대로 둔다)', () => {
    const variants = [{ id: red, archivedAt: null }, { id: blue, archivedAt: null }, { id: gray, archivedAt: '2026-11-01T00:00:00Z' }];
    expect(preorderEditorTargets(variants, [])).toEqual({ available: [variants[0], variants[1]], busy: [] });
    const policies = [{ variantId: red, state: 'active' as const }, { variantId: blue, state: 'stopped' as const }, { variantId: gray, state: 'active' as const }];
    expect(preorderEditorTargets(variants, policies)).toEqual({ available: [variants[1]], busy: [variants[0]] });
  });

  it('요청은 옵션마다 물량·일정을 싣고, 빈 칸·중복 옵션·모르는 키·100개 초과는 보내지 않는다', () => {
    expect(parseGoodsPreorderBulkRequest([{ variantId: red, ...values }, { variantId: blue, ...values, capacityQty: 30 }])).toEqual([
      { variantId: red, values: { capacityQty: 50, startsAt: '2099-12-01T01:00:00.000Z', endsAt: '2099-12-07T14:59:00.000Z', expectedShipDate: '2099-12-20' } },
      { variantId: blue, values: { capacityQty: 30, startsAt: '2099-12-01T01:00:00.000Z', endsAt: '2099-12-07T14:59:00.000Z', expectedShipDate: '2099-12-20' } },
    ]);
    for (const invalid of [[], 'x', [{ variantId: 'red', ...values }], [{ variantId: red, ...values, capacityQty: '' }], [{ variantId: red, ...values, endsAt: '' }],
      [{ variantId: red, ...values, expectedShipDate: '2099-12-06' }], [{ variantId: red, ...values }, { variantId: red, ...values }],
      [{ variantId: red, ...values, state: 'stopped' }], [{ variantId: red, ...values, policyId: null }],
      Array.from({ length: 101 }, (_, index) => ({ variantId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, ...values }))]) {
      expect(parseGoodsPreorderBulkRequest(invalid)).toBeNull();
    }
  });

  it('건너뛴 옵션은 이름을 들어 그대로 두었다고 알리고, 바꾸는 방법을 함께 말한다', () => {
    expect(preorderBulkSavedMessage(12, '')).toBe('옵션 12개에 예약판매를 저장했습니다. 접수 기간 동안 예약 물량으로 판매합니다.');
    expect(preorderBulkSavedMessage(1, '')).toBe('예약판매를 저장했습니다. 접수 기간 동안 예약 물량으로 판매합니다.');
    const skipped = preorderBulkSavedMessage(2, preorderOptionNames(['빨강', '파랑']));
    expect(skipped).toContain('옵션 2개에 예약판매를 저장했습니다.');
    expect(skipped).toContain('빨강·파랑 옵션은 이미 예약판매 중이라 그대로 두었습니다.');
    expect(skipped).toContain('[새 예약 접수 중지]');
    expect(preorderBulkSavedMessage(0, '빨강')).toMatch(/^빨강 옵션은 이미 예약판매 중이라 그대로 두었습니다\./);
    expect(preorderOptionNames(['가', '나', '다', '라', '마'])).toBe('가·나·다 외 2개');
  });

  it('판매기간·주문 후 제작과 겹친 저장은 무엇을 먼저 할지 알린다', () => {
    expect(preorderMutationError('goods_sale_period_preorder_conflict')).toContain("판매 시기에서 '예약판매'를 고르고 상품을 먼저 저장");
    expect(preorderMutationError('production_preorder_conflict')).toContain('주문 후 제작');
    expect(preorderMutationError('invalid_preorder_bulk')).toContain('새로고침');
    expect(preorderMutationError('goods_variant_inactive')).toContain('사용 중지한 옵션');
  });
});

describe('이전 회차 예약이 남은 옵션의 예약 물량 기본값', () => {
  /* 예약 주문은 입고 확인 전까지 재고수량을 줄이지 않는다. 접수를 중지한 옵션에 재고수량 그대로 새 예약을 받으면 이전 예약분만큼 더 팔린다. */
  it('재고수량에서 입고 확인 전 예약 수량을 뺀 값을 기본으로 넣는다', () => {
    const plan = { ...emptyPreorderPlan(), startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59', expectedShipDate: '2026-12-20' };
    const targets = [{ key: 'a', name: 'A', stockQty: 50, pendingQty: 30 }, { key: 'b', name: 'B', stockQty: 20 }];
    expect(expandPreorderPlan(plan, targets).map((entry) => [entry.key, entry.capacityQty, entry.capacityFromStock])).toEqual([['a', '20', true], ['b', '20', true]]);
  });

  it('이전 예약이 재고수량 이상이면 기본값을 넣지 않아 직접 입력해야 저장된다', () => {
    expect(preorderSellableStock({ stockQty: 30, pendingQty: 30 })).toBe(0);
    expect(preorderSellableStock({ stockQty: 10, pendingQty: 30 })).toBe(0);
    const [entry] = expandPreorderPlan(emptyPreorderPlan(), [{ key: 'a', name: 'A', stockQty: 30, pendingQty: 30 }]);
    expect(entry.capacityQty).toBe('');
  });

  it('직접 넣은 예약 물량은 그대로 쓰고, 이전 예약이 없으면 재고수량 그대로다', () => {
    const [entry] = expandPreorderPlan({ ...emptyPreorderPlan(), options: { a: { capacityQty: '45' } } }, [{ key: 'a', name: 'A', stockQty: 50, pendingQty: 30 }]);
    expect([entry.capacityQty, entry.capacityFromStock]).toEqual(['45', false]);
    expect(preorderSellableStock({ stockQty: 50 })).toBe(50);
    expect(preorderSellableStock({ stockQty: null })).toBeNull();
    expect(preorderSellableStock(undefined)).toBeUndefined();
  });
});

describe('옵션 표가 없는 화면의 예약 일정', () => {
  /* '옵션마다 일정을 다르게'로 한 옵션에 다른 날짜를 넣은 뒤 다른 옵션을 지워 그 옵션만 남으면, 화면은 공통 일정 칸만 보인다.
     보이는 공통 일정과 저장되는 일정이 같아야 한다(고객에게 약속하는 발송 예정일이 화면과 달라지면 안 된다). */
  const plan = { ...emptyPreorderPlan(), perOption: true, startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59', expectedShipDate: '2026-12-20',
    options: { only: { startsAt: '2027-01-05T10:00', endsAt: '2027-01-10T23:59', expectedShipDate: '2027-02-01' } } };
  const targets = [{ key: 'only', name: '빨강', stockQty: 10 }];

  it('표가 없으면 옵션별 일정을 쓰지 않고 공통 일정으로 펼친다', () => {
    expect(preorderPlanUsesOwnSchedules(plan, { table: false })).toBe(false);
    expect(expandPreorderPlan(plan, targets, { table: false })).toMatchObject([{ key: 'only', startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59', expectedShipDate: '2026-12-20' }]);
  });

  it('표가 있으면(옵션이 둘 이상인 상품에서 하나만 예약할 수 있을 때 포함) 넣어 둔 옵션별 일정을 그대로 쓴다', () => {
    expect(preorderPlanUsesOwnSchedules(plan, { table: true })).toBe(true);
    expect(expandPreorderPlan(plan, targets)).toMatchObject([{ key: 'only', startsAt: '2027-01-05T10:00', endsAt: '2027-01-10T23:59', expectedShipDate: '2027-02-01' }]);
    expect(preorderPlanUsesOwnSchedules(plan, { all: true })).toBe(false);
  });
});
