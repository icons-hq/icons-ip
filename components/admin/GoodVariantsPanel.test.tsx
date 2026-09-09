import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodVariantsPanel } from './GoodVariantsPanel';

describe('상품 옵션 확인', () => {
  it('선택한 상품의 옵션 가격과 할당 재고를 읽기 전용으로 표시한다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="good-1" variants={[
      { id: 'variant-1', code:'GOOD-1-01', goodId: 'good-1', name: '기본 옵션', price: 12000, stockQty: 3, isDefault: true, archivedAt: null },
      { id: 'variant-2', code:'GOOD-2-01', goodId: 'good-2', name: '다른 상품 옵션', price: 5000, stockQty: 9, isDefault: true, archivedAt: null },
    ]} />);
    for (const text of ['옵션 목록', '읽기 전용', '기본 옵션', '12,000원', '3개', '할당 재고']) expect(html).toContain(text);
    expect(html).not.toContain('다른 상품 옵션');
    expect(html).not.toMatch(/<(input|button|select|textarea)\b/);
  });

  it('백필이 없는 상품을 빈 목록으로 숨기지 않고 알린다', () => {
    const html = renderToStaticMarkup(<GoodVariantsPanel goodId="missing" variants={[]} />);
    expect(html).toContain('등록된 옵션이 없습니다.');
  });
});
