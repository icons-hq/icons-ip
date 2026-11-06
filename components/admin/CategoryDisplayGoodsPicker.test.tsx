import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/app/admin/category-display-actions', () => ({ searchCategoryDisplayGoodsAction: vi.fn(() => new Promise(() => {})) }));
import { CategoryDisplayGoodsPicker } from './CategoryDisplayGoodsPicker';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 검색만 조회 폼을 제출하고, 선택 완료·취소는 제출하지 않는다. */
it('전시 상품 선택의 검색은 조회 폼을 제출하고 선택 완료는 제출하지 않는다', () => {
  const html = renderToStaticMarkup(<CategoryDisplayGoodsPicker selected={[]} limit={10} onApply={vi.fn()} onClose={vi.fn()} />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색<\/button>/);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>선택 완료<\/button>/);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>취소<\/button>/);
});
