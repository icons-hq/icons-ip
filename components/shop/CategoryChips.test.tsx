import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildCategoryListingNav } from '@/lib/category-chips';
import type { StorefrontCategoryNode } from '@/lib/storefront-mega-menu';
import { CategoryChips } from './CategoryChips';

const id = (n: number) => `5a4c3000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const root = (n: number, name: string): StorefrontCategoryNode => ({ id: id(n), parentId: null, name, depth: 1, imageUrl: null, navigable: true });

describe('CategoryChips', () => {
  it('1줄과 2줄을 구분선(장식)으로 가르고 선택 칩만 aria-current 다', () => {
    const nodes = [root(1, '문구용품'), root(2, '인형'), root(3, '아크릴'), root(4, '피규어'), root(5, '디지털'), root(6, '홈데코')];
    const html = renderToStaticMarkup(<CategoryChips nav={buildCategoryListingNav(nodes, id(5))} />);

    expect(html).toContain('aria-label="카테고리"');
    expect(html.match(/<ul class="wc-listing-chips__row" data-tier="primary">/g)).toHaveLength(1);
    expect(html.match(/<ul class="wc-listing-chips__row" data-tier="secondary">/g)).toHaveLength(1);
    expect(html).toContain('<div aria-hidden="true" class="wc-listing-chips__rule"></div>');
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);
    expect(current).toEqual(['디지털']);
    expect(html).toContain('href="/shop"');
  });

  it('1단계가 4개 이하면 구분선도 2줄도 없다', () => {
    const html = renderToStaticMarkup(<CategoryChips nav={buildCategoryListingNav([root(1, '문구용품'), root(2, '인형')], null)} />);

    expect(html).not.toContain('wc-listing-chips__rule');
    expect(html).not.toContain('data-tier="secondary"');
    expect(html).toMatch(/<a aria-current="page" class="wc-listing-chip" href="\/shop">전체<\/a>/);
  });

  it('칩이 하나도 없으면(공개 트리 비어 있음) 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<CategoryChips nav={buildCategoryListingNav([], null)} />)).toBe('');
  });
});
