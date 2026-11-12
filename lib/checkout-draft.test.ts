import { describe, expect, it } from 'vitest';
import { checkoutDraftHref, checkoutDraftReturnHref, isClosedCheckoutDraft, normalizeCheckoutDraftId, parseCheckoutDraft, parseCheckoutDraftView } from './checkout-draft';

const id = '00000000-0000-4000-8000-0000000000d1';
const VARIANT = '00000000-0000-4000-8000-000000000002';
const ORDER = '00000000-0000-4000-8000-0000000000e1';
const valid = { id, source: 'selection', baseGoodId: null, expiresAt: '2026-11-12T10:00:00Z', stale: false, usedOrderId: null,
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
      { ...valid, lines: [{ ...valid.lines[0], customInputs: { revision: 0, fields: [] } }] }, { ...valid, stale: 'no' },
      { ...valid, usedOrderId: 'not-an-order' }]) {
      expect(parseCheckoutDraft(broken)).toBeNull();
    }
  });

  /* 같은 주문서로 이미 접수·결제한 주문은 원 주문으로 안내한다(다른 탭·뒤로 가기 재제출). */
  it('이미 주문한 주문서는 원 주문을 함께 읽는다', () => {
    expect(parseCheckoutDraft({ ...valid, usedOrderId: ORDER.toUpperCase() })?.usedOrderId).toBe(ORDER);
    /* 옛 응답(필드 없음)은 아직 주문하지 않은 주문서다. */
    const { usedOrderId: _omitted, ...legacy } = valid;
    void _omitted;
    expect(parseCheckoutDraft(legacy)?.usedOrderId).toBeNull();
  });

  /* 만료된 본인 주문서는 줄 없이 출처·상품 상세·원 주문만 남는다 — 바로구매는 '굿즈로 돌아가기'로 안내한다. */
  it('만료된 주문서는 줄 없는 닫힌 주문서로 읽고, 살아 있는 주문서로 착각하지 않는다', () => {
    const closed = { id, source: 'direct', baseGoodId: 'g2', expiresAt: '2026-11-12T10:00:00Z', closed: 'expired', usedOrderId: null, lines: [], stale: false };
    const view = parseCheckoutDraftView(closed);
    expect(view).toEqual({ id, source: 'direct', baseGoodId: 'g2', closed: 'expired', usedOrderId: null });
    expect(view && isClosedCheckoutDraft(view)).toBe(true);
    expect(parseCheckoutDraft(closed)).toBeNull();
    expect(parseCheckoutDraftView({ ...closed, usedOrderId: ORDER })).toMatchObject({ closed: 'expired', usedOrderId: ORDER });
    const live = parseCheckoutDraftView(valid);
    expect(live && isClosedCheckoutDraft(live)).toBe(false);
    for (const broken of [{ ...closed, closed: 'gone' }, { ...closed, baseGoodId: null }, { ...closed, usedOrderId: 'x' }, { ...closed, id: 'x' }]) {
      expect(parseCheckoutDraftView(broken)).toBeNull();
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
