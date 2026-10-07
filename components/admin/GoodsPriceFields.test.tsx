import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveGoodsPrice, type GoodsPriceDraft } from '@/lib/admin/goods-price-editor';
import { GoodsPriceFields } from './GoodsPriceFields';

const render = (changes: Partial<GoodsPriceDraft> = {}, showDiscountRate = 'true') => {
  const draft: GoodsPriceDraft = { regularPrice: '10000', discountEnabled: false, discountValue: '', discountUnit: 'won', ...changes };
  return renderToStaticMarkup(<GoodsPriceFields draft={draft} onDraftChange={() => {}} result={resolveGoodsPrice(draft)} errors={{}} showDiscountRate={showDiscountRate} />);
};

/** 할인 입력 묶음(설정안함이면 hidden) 안의 마크업 */
const discountBlock = (html: string) => {
  const start = html.indexOf('class="goods-price-editor__discount"');
  return html.slice(start, html.indexOf('class="goods-price-editor__result"', start));
};

describe('판매가·할인 입력', () => {
  /* 2026-10-07 리뷰: 할인율 표시는 기간 할인에도 쓰인다. 할인 설정안함 상품에서도 바꿀 수 있어야 한다. */
  it('고객 화면에 할인율 표시는 할인 설정과 상관없이 늘 보이고 기간 할인에도 적용된다고 안내한다', () => {
    for (const discountEnabled of [false, true]) {
      const html = render({ discountEnabled, discountValue: '1000' }, 'false');
      const rate = html.indexOf('name="showDiscountRate"');
      expect(rate, String(discountEnabled)).toBeGreaterThan(-1);
      expect(discountBlock(html)).not.toContain('showDiscountRate');
      expect(html.slice(html.lastIndexOf('<label', rate), rate)).toContain('고객 화면에 할인율 표시');
      expect(html).toContain('기간 할인에도 적용됩니다');
      expect(html).toMatch(/<option value="false" selected="">숨김 · 할인가만 표시<\/option>/);
    }
    expect(render()).toContain('class="goods-price-editor__discount" hidden=""');
  });

  /* 2026-10-07 리뷰: 숨긴 할인 입력에 남은 음수 값(rangeUnderflow)이 설정안함 상태의 저장을 막았다. */
  it('할인 설정안함이면 할인 입력을 검증·제출에서 빼고, 입력값은 복구용 hidden 값으로 보존한다', () => {
    const off = render({ discountEnabled: false, discountValue: '-10', discountUnit: 'percent' });
    expect(off).toMatch(/<input[^>]*id="goods-discount-value"[^>]*disabled=""/);
    expect(off).toMatch(/<select[^>]*name="discountUnit"[^>]*disabled=""/);
    expect(off).toContain('<input type="hidden" name="discountValue" value="-10"/>');
    expect(off).toContain('<input type="hidden" name="discountUnit" value="percent"/>');
    expect(off).toContain('<input type="hidden" name="price" value="10000"/>');
    expect(off).toContain('<input type="hidden" name="compareAtPrice" value=""/>');

    const on = render({ discountEnabled: true, discountValue: '1000' });
    expect(on).not.toMatch(/<input[^>]*id="goods-discount-value"[^>]*disabled=""/);
    expect(on).not.toContain('type="hidden" name="discountValue"');
    expect(on).not.toContain('type="hidden" name="discountUnit"');
    expect(on).toMatch(/<input[^>]*name="discountValue"[^>]*value="1000"/);
  });
});
