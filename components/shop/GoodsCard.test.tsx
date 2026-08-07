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

  /* 이미지 링크 안에는 읽을 텍스트가 없어 접근 가능한 이름이 빈 문자열이다.
     접근성 트리에서 빼지 않으면 axe link-name(WCAG 2.4.4) 위반이 굿즈 개수만큼
     나고 스크린리더 링크 목록에 이름 없는 링크가 하나씩 더 쌓인다. */
  it('keeps the nameless image link out of the accessibility tree', () => {
    const html = renderToStaticMarkup(
      <GoodsCard action={<button type="button">담기</button>} good={good} href="/shop/g13" />,
    );

    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(2);

    const [imageLink, nameLink] = links;
    /* aria-hidden 안에 초점 가능한 요소를 남기면 그 자체가 위반이다. */
    expect(imageLink[1]).toContain('aria-hidden="true"');
    expect(imageLink[1]).toContain('tabindex="-1"');

    /* 노출되는 링크는 하나뿐이고, 그 링크는 이름을 읽어줄 텍스트를 가진다. */
    expect(nameLink[1]).not.toContain('aria-hidden');
    expect(nameLink[1]).not.toContain('tabindex');
    expect(nameLink[2].replace(/<[^>]*>/g, '')).toContain('아크릴 블록');
  });

  it('renders without a link when no detail href is given', () => {
    const html = renderToStaticMarkup(
      <GoodsCard action={<span>미리보기</span>} good={good} />,
    );

    expect(html).not.toContain('<a ');
    expect(html).toContain('미리보기');
  });
});
