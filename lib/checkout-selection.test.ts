import { describe, expect, it } from 'vitest';
import {
  cartLineIdentityPayload,
  cartLineKey,
  cartOrderButtonLabel,
  cartSelectionQuantity,
  pruneCartSelection,
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
