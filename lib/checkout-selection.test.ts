import { describe, expect, it } from 'vitest';
import {
  cartLineIdentityPayload,
  cartLineKey,
  cartOrderButtonLabel,
  cartSelectionQuantity,
  pruneCartSelection,
  quoteCoversSelection,
  quoteExcludedLines,
  quoteExclusionKey,
  quoteMayBeBlockedByPendingOrder,
  selectedCartLines,
  toggleAllCartLines,
  toggleCartLineSelection,
  transactionIssuesMayBeBlockedByPendingOrder,
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
  it('거래 런타임 견적은 구매 한도·쿠폰 막힘만 안내한다', () => {
    expect(transactionIssuesMayBeBlockedByPendingOrder([{ code: 'purchase_limit' }])).toBe(true);
    expect(transactionIssuesMayBeBlockedByPendingOrder([{ code: 'coupon_unavailable' }])).toBe(true);
    expect(transactionIssuesMayBeBlockedByPendingOrder([{ code: 'goods_unavailable' }, { code: 'address_required' }])).toBe(false);
  });
});

/* 견적이 판정한 불가 줄은 선택에서 빼고 사유를 줄에 보인다(ADR-0030 확정 동작 2 — 전체 주문을 막지 않는다). */
describe('견적이 판정한 주문할 수 없는 줄', () => {
  const VA = '00000000-0000-4000-8000-00000000000a';
  const VB = '00000000-0000-4000-8000-00000000000b';
  const base = { regularPrice: 1000, effectivePrice: 1000, pricePeriodId: null, startsAt: null, endsAt: null };
  const good = (goodId: string, reason: string | null = null) => ({ goodId, qty: 1, orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
    memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason } as never);
  const a = { goodId: 'a', variantId: VA, qty: 2 };
  const b = { goodId: 'b', variantId: VB, qty: 1 };
  const name = () => '옵션';
  it('품절·재고 부족 줄은 사유와 함께 빼고, 키에 수량을 넣어 수량을 바꾸면 다시 판정한다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: false,
      supply: { mode: 'stock', availableQty: 1, policyId: null, policyRevision: null, state: 'stock', startsAt: null, endsAt: null, expectedShipDate: null,
        calculatedAt: '2026-11-12T00:00:00Z', nextChangeAt: null } }, { ...base, goodId: 'b', variantId: VB, qty: 1, available: true }] as never,
      goods: [good('a'), good('b')] };
    const excluded = quoteExcludedLines([a, b], quote, name);
    expect([...excluded.keys()]).toEqual([quoteExclusionKey(a)]);
    expect(excluded.get(quoteExclusionKey(a))?.message).toContain('재고가 1개만 남아');
    expect(quoteExclusionKey({ ...a, qty: 1 })).not.toBe(quoteExclusionKey(a));
  });
  it('굿즈 사유는 그 굿즈의 고른 줄을 모두 빼고, 회원 누적 한도는 결제 대기 주문이 원인일 수 있다고 표시한다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: true }, { ...base, goodId: 'b', variantId: VB, qty: 1, available: true }] as never,
      goods: [good('a', 'member_purchase_limit_exceeded'), good('b', 'order_quantity_above_maximum')] };
    const excluded = quoteExcludedLines([a, b], quote, name);
    expect(excluded.get(quoteExclusionKey(a))).toMatchObject({ pendingOrderMayBlock: true });
    expect(excluded.get(quoteExclusionKey(b))).toMatchObject({ pendingOrderMayBlock: false });
  });
  it('다른 선택의 견적으로는 줄을 빼지 않는다', () => {
    const quote = { lines: [{ ...base, goodId: 'a', variantId: VA, qty: 2, available: true }] as never, goods: [] };
    expect(quoteCoversSelection([a], quote)).toBe(true);
    expect(quoteCoversSelection([a, b], quote)).toBe(false);
    expect(quoteCoversSelection([], quote)).toBe(false);
  });
});
