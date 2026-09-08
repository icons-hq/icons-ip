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
});
