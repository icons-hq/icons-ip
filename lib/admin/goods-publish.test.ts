import { describe, expect, it } from 'vitest';
import { normalizeAdminGoodForm } from './catalog';
import { canSellAdminGood } from './goods-publish';

describe('상품 초안과 판매 가능 상태', () => {
  it('상품명과 IP만으로 초안을 저장하고 공개 제출에는 누락 항목을 안내한다', () => {
    const form = new FormData();
    form.set('name', '준비 중인 상품');
    form.set('ipId', 'hwasan');
    const context = { ipIds: new Set(['hwasan']), eventIds: new Set<string>(), goodIpById: new Map<string,string>(), verticalKeys: new Set<string>() };
    expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: true, value: { publish: null, type: '', price: 0 } });
    form.set('intent', 'publish');
    expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: false, errors: { imagePath: expect.any(String), noticeMaker: expect.any(String), type: expect.any(String) } });
  });
  it('공개·재고·고시정보 완료를 모두 갖춘 비보관 상품만 판매 가능하다', () => {
    const ready = { publishedAt: '2026-09-08', archivedAt: null, stockQty: 3, noticeComplete: true };
    expect(canSellAdminGood(ready)).toBe(true);
    expect(canSellAdminGood({ ...ready, publishedAt: null })).toBe(false);
    expect(canSellAdminGood({ ...ready, stockQty: 0 })).toBe(false);
    expect(canSellAdminGood({ ...ready, noticeComplete: false })).toBe(false);
    expect(canSellAdminGood({ ...ready, archivedAt: '2026-09-08' })).toBe(false);
  });
  it('중지 옵션에 재고가 남아 있어도 판매 가능으로 표시하지 않고 복원하면 실제 옵션 재고를 따른다', () => {
    const ready = { publishedAt: '2026-09-08', archivedAt: null, stock: 'ok' as const, stockQty: 10, noticeComplete: true };
    expect(canSellAdminGood(ready, [{ stockQty: 10, archivedAt: '2026-09-10' }])).toBe(false);
    expect(canSellAdminGood(ready, [])).toBe(false);
    expect(canSellAdminGood(ready, [{ stockQty: 10, archivedAt: null }])).toBe(true);
    expect(canSellAdminGood({ ...ready, stock: 'soldout' }, [{ stockQty: 10, archivedAt: null }])).toBe(false);
  });
  it('서버가 계산한 예약 가능 수량을 실재고와 구별하고 수동 품절과 결제수단 제한은 유지한다', () => {
    const good = { publishedAt: '2026-09-10', archivedAt: null, stock: 'ok' as const, stockQty: 0, saleAvailableQty: 3, noticeComplete: true };
    expect(canSellAdminGood(good, [{ stockQty: 0, archivedAt: null }])).toBe(true);
    expect(canSellAdminGood({ ...good, saleAvailableQty: 0 }, [{ stockQty: 10, archivedAt: null }])).toBe(false);
    expect(canSellAdminGood({ ...good, stock: 'soldout' })).toBe(false);
    expect(canSellAdminGood({ ...good, allowCardPayment: false, allowBankTransfer: false })).toBe(false);
  });
});
