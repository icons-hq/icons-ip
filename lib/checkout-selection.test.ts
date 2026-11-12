import { describe, expect, it } from 'vitest';
import {
  cartLineIdentityPayload,
  cartLineKey,
  cartOrderButtonLabel,
  cartSelectionQuantity,
  pruneCartSelection,
  cartGoodSignature,
  goodsLimitNoteMessage,
  parseUnpaidCheckoutOrders,
  quoteCoversSelection,
  quoteExclusionKey,
  quoteLimitNotes,
  quoteMayBeBlockedByPendingOrder,
  quoteUnavailableLines,
  relevantUnpaidCheckoutOrders,
  transactionIssueStockGoodIds,
  hasPendingOrderCause,
  mergePendingOrderCauses,
  pendingOrderCausesFromQuote,
  pendingOrderCausesFromTransactionIssues,
  unpaidOrderCauseMessage,
  unpaidCheckoutOrderSummary,
  selectedCartLines,
  toggleAllCartLines,
  toggleCartLineSelection,
} from './checkout-selection';

const A = { goodId: 'a', variantId: '00000000-0000-4000-8000-00000000000a', qty: 1 };
const B = { goodId: 'b', variantId: '00000000-0000-4000-8000-00000000000b', qty: 2 };
const SOLD = { goodId: 'sold', variantId: '00000000-0000-4000-8000-00000000000c', qty: 1 };
const engraved = (value: string) => ({ goodId: 'e', variantId: '00000000-0000-4000-8000-00000000000e', qty: 1,
  customInputs: { revision: 1, fields: [{ id: '00000000-0000-4000-8000-0000000000f1', name: '각인', value }] } });
const available = (line: { goodId: string }) => line.goodId !== 'sold';

describe('장바구니 선택(ADR-0030 · 1014-031)', () => {
  it('들어오면 고를 수 있는 줄이 모두 체크돼 있고, 주문할 수 없는 줄은 선택에서 빠진다', () => {
    expect(selectedCartLines([A, B, SOLD], new Set(), available)).toEqual([A, B]);
  });

  it('체크를 푼 줄만 빠지고, 같은 옵션의 다른 직접입력값 줄은 따로 고른다', () => {
    const one = engraved('하나');
    const two = engraved('둘');
    const deselected = toggleCartLineSelection(new Set(), cartLineKey(one), false);
    expect(selectedCartLines([A, one, two], deselected, available)).toEqual([A, two]);
    expect(selectedCartLines([A, one, two], toggleCartLineSelection(deselected, cartLineKey(one), true), available)).toEqual([A, one, two]);
  });

  it('전체 선택은 고를 수 있는 줄 전부를 켜고 끈다', () => {
    const keys = [A, B].map(cartLineKey);
    const none = toggleAllCartLines(new Set(), keys, false);
    expect(selectedCartLines([A, B, SOLD], none, available)).toEqual([]);
    expect(selectedCartLines([A, B, SOLD], toggleAllCartLines(none, keys, true), available)).toEqual([A, B]);
  });

  it('장바구니에서 사라진 줄의 해제 기록은 버린다 — 다시 담으면 체크된 채 보인다', () => {
    const deselected = toggleCartLineSelection(new Set(), cartLineKey(B), false);
    const pruned = pruneCartSelection(deselected, [A]);
    expect(pruned.size).toBe(0);
    expect(selectedCartLines([A, B], pruned, available)).toEqual([A, B]);
    /* 바뀐 것이 없으면 같은 집합을 그대로 돌려준다(렌더마다 새 상태를 만들지 않는다). */
    expect(pruneCartSelection(deselected, [A, B])).toBe(deselected);
  });

  it("주문 버튼은 고른 줄의 수량 합으로 'N개 주문하기'다(SHEET-007)", () => {
    expect(cartSelectionQuantity([A, B])).toBe(3);
    expect(cartOrderButtonLabel(cartSelectionQuantity([A, B]))).toBe('3개 주문하기');
  });

  it('DB 줄 식별은 굿즈·옵션·직접입력 개정·값이다', () => {
    expect(cartLineIdentityPayload(A)).toEqual({ good_id: 'a', variant_id: A.variantId, input_revision: 0, input_values: {} });
    expect(cartLineIdentityPayload(engraved('하나'))).toEqual({ good_id: 'e', variant_id: '00000000-0000-4000-8000-00000000000e',
      input_revision: 1, input_values: { '00000000-0000-4000-8000-0000000000f1': '하나' } });
  });
});

/* 결제 대기 주문이 잡은 쿠폰·첫구매 예약·1인 누적 한도는 화면이 그 주문을 알리고 고객이 누를 때만 닫는다(ADR-0030). */
describe('결제 대기 주문이 원인일 수 있는 견적 막힘', () => {
  const clear = { coupon: null, goods: [{ reason: null }], lines: [{ optionLimit: { reason: null } }] };
  it('쿠폰 사용 처리·첫구매 예약·회원 누적 한도면 안내한다', () => {
    for (const reason of ['coupon_first_purchase_reserved', 'coupon_first_purchase_pending', 'coupon_already_used']) {
      expect(quoteMayBeBlockedByPendingOrder({ ...clear, coupon: { reason } })).toBe(true);
    }
    expect(quoteMayBeBlockedByPendingOrder({ ...clear, goods: [{ reason: 'member_purchase_limit_exceeded' }] })).toBe(true);
    expect(quoteMayBeBlockedByPendingOrder({ ...clear, lines: [{ optionLimit: { reason: 'option_member_limit_exceeded' } }] })).toBe(true);
  });
  it('결제 대기 주문과 무관한 막힘은 안내하지 않는다', () => {
    expect(quoteMayBeBlockedByPendingOrder(clear)).toBe(false);
    expect(quoteMayBeBlockedByPendingOrder({ ...clear, coupon: { reason: 'coupon_min_subtotal' } })).toBe(false);
    expect(quoteMayBeBlockedByPendingOrder({ ...clear, goods: [{ reason: 'order_quantity_above_maximum' }] })).toBe(false);
    expect(quoteMayBeBlockedByPendingOrder({ ...clear, lines: [{ optionLimit: { reason: 'option_order_limit_exceeded' } }] })).toBe(false);
  });
  /* 원인 조건은 사유마다 좁다 — 그 굿즈(옵션)·그 쿠폰. 모든 결제 대기 주문이 원인일 수 있는 것은 첫구매 예약뿐이다. */
  it('견적 사유에서 원인 조건을 그 굿즈·옵션·쿠폰으로 읽는다', () => {
    const VX = '00000000-0000-4000-8000-0000000000aa';
    const coupon = '00000000-0000-4000-8000-0000000000c1';
    expect(pendingOrderCausesFromQuote({ coupon: { reason: 'coupon_already_used', userCouponId: coupon },
      goods: [{ goodId: 'g4', reason: 'member_purchase_limit_exceeded' }, { goodId: 'g9', reason: 'order_quantity_above_maximum' }],
      lines: [{ variantId: VX, optionLimit: { reason: 'option_member_limit_exceeded' } }] }))
      .toEqual({ firstPurchase: false, userCouponIds: [coupon], limitGoodIds: ['g4'], limitVariantIds: [VX] });
    expect(pendingOrderCausesFromQuote({ coupon: { reason: 'coupon_first_purchase_reserved', userCouponId: coupon }, goods: [], lines: [] }))
      .toMatchObject({ firstPurchase: true, userCouponIds: [] });
    expect(hasPendingOrderCause(pendingOrderCausesFromQuote({ coupon: { reason: 'coupon_min_subtotal' }, goods: [], lines: [] }))).toBe(false);
  });
  it('거래 런타임 이슈에서 원인 조건을 읽는다(구매 한도는 그 굿즈, 쿠폰은 고른 쿠폰, 지금 살 수 없음은 그 굿즈 재고)', () => {
    const coupon = '00000000-0000-4000-8000-0000000000c1';
    expect(pendingOrderCausesFromTransactionIssues([{ code: 'purchase_limit', goodId: 'g4' }, { code: 'coupon_unavailable' },
      { code: 'goods_unavailable', goodId: 'g6' }, { code: 'address_required' }], [coupon]))
      .toEqual({ limitGoodIds: ['g4'], userCouponIds: [coupon], stockGoodIds: ['g6'] });
    expect(hasPendingOrderCause(pendingOrderCausesFromTransactionIssues([{ code: 'address_required' }], [coupon]))).toBe(false);
  });
  it('원인 조건을 합치면 같은 값은 한 번만 남는다', () => {
    expect(mergePendingOrderCauses({ stockGoodIds: ['b', 'a'] }, { stockGoodIds: ['a'], firstPurchase: true }))
      .toEqual({ firstPurchase: true, userCouponIds: [], limitGoodIds: [], limitVariantIds: [], stockGoodIds: ['a', 'b'] });
  });
});

/* 견적이 판정한 줄 단위 불가는 선택에서 빼고 사유를 줄에 보인다(ADR-0030 확정 동작 2 — 전체 주문을 막지 않는다). 구매 수량
   조건은 줄을 빼지 않고 체크만 풀어 사유를 보인다(UI 재리뷰 — 다시 고르면 다시 견적한다). */
describe('견적이 판정한 주문할 수 없는 줄·구매 조건', () => {
  const VA = '00000000-0000-4000-8000-00000000000a';
  const VB = '00000000-0000-4000-8000-00000000000b';
  const VC = '00000000-0000-4000-8000-00000000000c';
  const base = { regularPrice: 1000, effectivePrice: 1000, pricePeriodId: null, startsAt: null, endsAt: null };
  const supply = (availableQty: number) => ({ mode: 'stock', availableQty, policyId: null, policyRevision: null, state: 'stock', startsAt: null, endsAt: null,
    expectedShipDate: null, calculatedAt: '2026-11-12T00:00:00Z', nextChangeAt: null });
  const good = (goodId: string, extra: Record<string, unknown> = {}) => ({ goodId, qty: 1, orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
    memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason: null, ...extra } as never);
  const a = { goodId: 'a', variantId: VA, qty: 2 };
  const b = { goodId: 'b', variantId: VB, qty: 1 };
  const name = () => '옵션';

  it('품절·재고 부족 줄은 사유와 함께 빼고, 키에 수량을 넣어 수량을 바꾸면 다시 판정한다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: false, supply: supply(1) },
      { ...base, goodId: 'b', variantId: VB, qty: 1, available: false, supply: supply(0) }] as never };
    const excluded = quoteUnavailableLines([a, b], quote);
    expect(excluded.get(quoteExclusionKey(a))).toMatchObject({ reducible: true, stockShort: true });
    expect(excluded.get(quoteExclusionKey(a))?.message).toContain('재고가 1개만 남아');
    /* 남은 재고가 없으면 수량 조정을 권하지 않는다. */
    expect(excluded.get(quoteExclusionKey(b))).toMatchObject({ reducible: false, stockShort: true, message: '판매 상태나 재고가 바뀌어 이번 주문에서 빠졌어요.' });
    expect(quoteExclusionKey({ ...a, qty: 1 })).not.toBe(quoteExclusionKey(a));
  });

  it('굿즈 사유는 그 굿즈의 고른 줄 모두에 체크 해제 사유를 달고, 회원 누적 한도는 결제 대기 주문이 원인일 수 있다고 표시한다', () => {
    const a2 = { goodId: 'a', variantId: VC, qty: 1 };
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: true }, { ...base, goodId: 'a', variantId: VC, qty: 1, available: true },
      { ...base, goodId: 'b', variantId: VB, qty: 1, available: true }] as never,
      goods: [good('a', { qty: 3, orderQuantityLimitEnabled: true, minOrderQty: 1, maxOrderQty: 2, reason: 'order_quantity_above_maximum' }),
        good('b', { memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 3, memberReservedQty: 3, memberRemainingQty: 0, reason: 'member_purchase_limit_exceeded' })] };
    const notes = quoteLimitNotes([a, a2, b], quote, name);
    expect([...notes.get('a')!.lines.keys()]).toEqual([cartLineKey(a), cartLineKey(a2)]);
    expect(notes.get('a')).toMatchObject({ pendingOrderMayBlock: false });
    expect(notes.get('a')!.lines.get(cartLineKey(a))).toBe('주문당 최대 2개까지 구매할 수 있어요. 옵션을 합해 2개 이하로 골라주세요.');
    expect(notes.get('b')).toMatchObject({ pendingOrderMayBlock: true });
    /* 결제 대기 주문 원인 조건은 회원 누적 한도에 걸린 그 굿즈뿐이다(주문당 수량은 결제 대기 주문과 무관하다). */
    expect(notes.get('a')!.pendingCauses).toEqual({ limitGoodIds: [], limitVariantIds: [] });
    expect(notes.get('b')!.pendingCauses).toEqual({ limitGoodIds: ['b'], limitVariantIds: [] });
    /* 줄 단위 불가는 구매 조건이 아니다 — 비활성 제외(quoteUnavailableLines)가 맡는다. */
    expect(quoteUnavailableLines([a, a2, b], quote).size).toBe(0);
  });

  it('옵션 한도 사유는 그 옵션 줄에만 단다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: true,
      optionLimit: { orderMaxQty: 1, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null, reason: 'option_order_limit_exceeded' } },
    { ...base, goodId: 'a', variantId: VC, qty: 1, available: true }] as never, goods: [good('a', { qty: 3 })] };
    const notes = quoteLimitNotes([a, { goodId: 'a', variantId: VC, qty: 1 }], quote, name);
    expect([...notes.get('a')!.lines.keys()]).toEqual([cartLineKey(a)]);
    expect(notes.get('a')).toMatchObject({ pendingOrderMayBlock: false, pendingCauses: { limitGoodIds: [], limitVariantIds: [] } });
  });

  it('구매 조건 안내는 한도 수치로 말하고, 남은 한도가 없으면 수량 조정을 권하지 않는다', () => {
    expect(goodsLimitNoteMessage(good('a', { minOrderQty: 3, reason: 'order_quantity_below_minimum' }))).toBe('최소 3개부터 구매할 수 있어요. 옵션을 합해 3개 이상 골라주세요.');
    expect(goodsLimitNoteMessage(good('a', { memberLifetimeQtyLimit: 5, memberRemainingQty: 2, reason: 'member_purchase_limit_exceeded' })))
      .toBe('회원 누적 구매 한도로 2개까지 더 구매할 수 있어요. 수량을 줄여 골라주세요.');
    const reached = goodsLimitNoteMessage(good('a', { memberLifetimeQtyLimit: 5, memberRemainingQty: 0, reason: 'member_purchase_limit_exceeded' }));
    expect(reached).toContain('회원 누적 구매 한도(5개)에 도달했어요.');
    expect(reached).not.toContain('수량을');
    expect(goodsLimitNoteMessage(good('a'))).toBeNull();
  });

  it('굿즈 줄 집합의 서명은 체크·해제·삭제·수량 변경에 바뀌고 다른 굿즈의 변경에는 그대로다', () => {
    const a2 = { goodId: 'a', variantId: VC, qty: 1 };
    const off = new Set([cartLineKey(a), cartLineKey(a2)]);
    const sign = (items: typeof a[], keys: ReadonlySet<string>) => cartGoodSignature(items.map((item) => (
      { goodId: item.goodId, key: cartLineKey(item), qty: item.qty, checked: !keys.has(cartLineKey(item)) })), 'a');
    const signature = sign([a, a2, b], off);
    expect(sign([a, a2, { ...b, qty: 3 }], off)).toBe(signature);
    expect(sign([a, a2, b], new Set([cartLineKey(a2)]))).not.toBe(signature);
    expect(sign([a, b], off)).not.toBe(signature);
    expect(sign([{ ...a, qty: 1 }, a2, b], off)).not.toBe(signature);
  });

  it('다른 선택·바뀌기 전 수량의 견적으로는 줄을 빼지 않는다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: true }] as never, goods: [] };
    expect(quoteCoversSelection([a], quote)).toBe(true);
    expect(quoteCoversSelection([{ ...a, qty: 3 }], quote)).toBe(false);
    expect(quoteCoversSelection([a, b], quote)).toBe(false);
    expect(quoteCoversSelection([], quote)).toBe(false);
    /* 같은 옵션의 직접입력 줄은 수량을 합해 견적 줄 하나와 맞춘다. */
    expect(quoteCoversSelection([{ ...a, qty: 1 }, { ...a, qty: 1, customInputs: { revision: 1, fields: [] } }], quote)).toBe(true);
  });

  it('거래 런타임의 지금 주문할 수 없는 굿즈를 모은다', () => {
    expect(transactionIssueStockGoodIds([{ code: 'goods_unavailable', goodId: 'a' }, { code: 'goods_unavailable', goodId: 'a' },
      { code: 'purchase_limit', goodId: 'b' }, { code: 'goods_unavailable', goodId: null }])).toEqual(['a']);
  });
});

/* '결제 대기 주문 취소하고 계속'의 확인창(ADR-0030): 결제 대기 주문을 실제로 찾았을 때만, 원인일 수 있는 주문만 보인다. */
describe('결제 대기 주문 확인창', () => {
  const ORDER = '00000000-0000-4000-8000-0000000000e1';
  const VA = '00000000-0000-4000-8000-00000000000a';
  const COUPON = '00000000-0000-4000-8000-0000000000c1';
  const row = { id: ORDER.toUpperCase(), orderNumber: '2026111210000001', total: 23000, itemName: '굿즈 A', itemCount: 3, goodIds: ['a', 'b'],
    variantIds: [VA.toUpperCase()], userCouponIds: [COUPON], releasable: true };
  it('목록 모양이 하나라도 틀리면 믿지 않는다', () => {
    expect(parseUnpaidCheckoutOrders([row])).toEqual([{ ...row, id: ORDER, variantIds: [VA] }]);
    expect(parseUnpaidCheckoutOrders([])).toEqual([]);
    for (const broken of [{ ...row, id: 'x' }, { ...row, total: '23000' }, { ...row, goodIds: [1] }, { ...row, releasable: 'yes' },
      { ...row, variantIds: ['x'] }, { ...row, userCouponIds: undefined }, null]) {
      expect(parseUnpaidCheckoutOrders([broken])).toBeNull();
    }
    expect(parseUnpaidCheckoutOrders({})).toBeNull();
  });
  /* t12b(UI 재리뷰): g4의 회원 누적 한도로 막혔는데 무관한 g7 결제 대기 주문을 원인으로 권해, 취소해도 g4는 그대로 막혔다. */
  it('재고·회원 누적 한도는 그 굿즈(옵션)를 담은 주문, 쿠폰 사용은 그 쿠폰을 쓴 주문, 첫구매 예약만 모든 주문을 원인으로 본다', () => {
    const [order] = parseUnpaidCheckoutOrders([row])!;
    const unrelated = { ...order, id: '00000000-0000-4000-8000-0000000000e2', goodIds: ['g7'], variantIds: [], userCouponIds: [] };
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { limitGoodIds: ['g4'] })).toEqual([]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { limitGoodIds: ['a'] })).toEqual([order]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { limitVariantIds: [VA] })).toEqual([order]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { stockGoodIds: ['g7'] })).toEqual([unrelated]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { userCouponIds: [COUPON] })).toEqual([order]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], { firstPurchase: true })).toEqual([order, unrelated]);
    expect(relevantUnpaidCheckoutOrders([order, unrelated], {})).toEqual([]);
  });
  it('해소 안내는 원인 주문 건수와 그 주문이 잡은 것을 말한다', () => {
    const [order] = parseUnpaidCheckoutOrders([row])!;
    expect(unpaidOrderCauseMessage([order], { limitGoodIds: ['a'] })).toBe('결제 대기 주문 1건이 이 굿즈의 구매 한도를 잡고 있어요.');
    expect(unpaidOrderCauseMessage([order], { stockGoodIds: ['b'] })).toBe('결제 대기 주문 1건이 이 굿즈의 재고를 잡고 있어요.');
    expect(unpaidOrderCauseMessage([order], { userCouponIds: [COUPON] })).toBe('결제 대기 주문 1건이 이 쿠폰을 쓰고 있어요.');
    expect(unpaidOrderCauseMessage([order], { firstPurchase: true })).toBe('결제 대기 주문 1건이 첫구매 혜택을 잡고 있을 수 있어요.');
    expect(unpaidOrderCauseMessage([order], { userCouponIds: [COUPON], stockGoodIds: ['a'] })).toBe('결제 대기 주문 1건이 쿠폰·재고를 잡고 있어요.');
    expect(unpaidOrderCauseMessage([order], { limitGoodIds: ['a'], firstPurchase: true })).toBe('결제 대기 주문 1건이 첫구매 혜택·구매 한도를 잡고 있을 수 있어요.');
  });
  it('주문 요약은 첫 굿즈와 나머지 품목 수다', () => {
    expect(unpaidCheckoutOrderSummary({ itemName: '굿즈 A', itemCount: 3 })).toBe('굿즈 A 외 2건');
    expect(unpaidCheckoutOrderSummary({ itemName: '굿즈 A', itemCount: 1 })).toBe('굿즈 A');
    expect(unpaidCheckoutOrderSummary({ itemName: null, itemCount: 1 })).toBe('굿즈');
  });
});
