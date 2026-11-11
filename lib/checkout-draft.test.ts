import { describe, expect, it } from 'vitest';
import { checkoutDraftHref, checkoutDraftReturnHref, normalizeCheckoutDraftId, parseCheckoutDraft } from './checkout-draft';

const id = '00000000-0000-4000-8000-0000000000d1';
const VARIANT = '00000000-0000-4000-8000-000000000002';
const valid = { id, source: 'selection', baseGoodId: null, expiresAt: '2026-11-12T10:00:00Z', stale: false,
  lines: [{ goodId: 'g2', variantId: VARIANT, qty: 2, customInputs: null }] };

describe('주문서 초안(ADR-0030)', () => {
  it('DB 응답을 장바구니 줄 모양으로 읽고, 직접입력값 스냅샷을 줄에 붙인다', () => {
    expect(parseCheckoutDraft(valid)).toEqual({ ...valid, lines: [{ goodId: 'g2', variantId: VARIANT, qty: 2 }] });
    const customInputs = { revision: 1, fields: [{ id: '00000000-0000-4000-8000-0000000000f1', name: '각인', value: 'ICONS' }] };
    expect(parseCheckoutDraft({ ...valid, lines: [{ ...valid.lines[0], customInputs }] })?.lines[0].customInputs).toEqual(customInputs);
  });

  it('바로구매는 상품 상세 굿즈가 있어야 하고, 선택 주문은 없어야 한다', () => {
    expect(parseCheckoutDraft({ ...valid, source: 'direct', baseGoodId: 'g2' })?.baseGoodId).toBe('g2');
    expect(parseCheckoutDraft({ ...valid, source: 'direct' })).toBeNull();
    expect(parseCheckoutDraft({ ...valid, baseGoodId: 'g2' })).toBeNull();
  });

  it('모양이 틀린 응답은 초안을 못 읽은 것으로 다룬다', () => {
    for (const broken of [null, [], { ...valid, id: 'x' }, { ...valid, source: 'cart' }, { ...valid, lines: [] },
      { ...valid, lines: [{ ...valid.lines[0], qty: 0 }] }, { ...valid, lines: [{ ...valid.lines[0], variantId: 'x' }] },
      { ...valid, lines: [{ ...valid.lines[0], customInputs: { revision: 0, fields: [] } }] }, { ...valid, stale: 'no' }]) {
      expect(parseCheckoutDraft(broken)).toBeNull();
    }
  });

  it('주문서 주소·되돌아가기 목적지', () => {
    expect(normalizeCheckoutDraftId(` ${id.toUpperCase()} `)).toBe(id);
    expect(normalizeCheckoutDraftId('../cart')).toBeNull();
    expect(checkoutDraftHref(id)).toBe(`/checkout?draft=${id}`);
    expect(checkoutDraftReturnHref({ source: 'selection', baseGoodId: null })).toBe('/cart');
    expect(checkoutDraftReturnHref({ source: 'direct', baseGoodId: 'g2' })).toBe('/shop/g2');
    expect(checkoutDraftReturnHref(null)).toBe('/cart');
  });
});
