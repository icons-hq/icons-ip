import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Good } from '@/lib/data';
import { GoodsCard } from './GoodsCard';

const good: Good = {
  id: 'g13',
  name: '아크릴 블록',
  ip: 'hong-sil-quest',
  type: '아크릴 블록',
  price: 12000,
  badge: '신상',
  stock: 'ok',
  stockQty: 8,
  img: 'linear-gradient(#111, #222)',
};

describe('GoodsCard', () => {
  /* #173 완료 조건 — 담기 버튼 클릭이 상세 이동을 트리거하면 안 된다. */
  it('keeps the cart action outside the detail link', () => {
    const html = renderToStaticMarkup(
      <GoodsCard action={<button type="button">담기</button>} good={good} href="/shop/g13" />,
    );

    expect(html).toContain('href="/shop/g13"');
    /* 링크 안에 버튼이 없다 — 마지막 </a> 뒤에서만 버튼이 나온다. */
    expect(html.indexOf('<button')).toBeGreaterThan(html.lastIndexOf('</a>'));
    expect(html).toContain('₩12,000');
    expect(html).toContain('아크릴 블록');
  });

  it('renders without a link when no detail href is given', () => {
    const html = renderToStaticMarkup(
      <GoodsCard action={<span>미리보기</span>} good={good} />,
    );

    expect(html).not.toContain('<a ');
    expect(html).toContain('미리보기');
  });
});
