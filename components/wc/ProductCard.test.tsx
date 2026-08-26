import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductCard } from './ProductCard';

const card = {
  href: '/shop/g13',
  name: '아크릴 블록',
  price: 12000,
};

describe('ProductCard', () => {
  /* 이미지 링크 안에는 읽을 텍스트가 없어 접근 가능한 이름이 빈 문자열이다.
     접근성 트리에서 빼지 않으면 axe link-name(WCAG 2.4.4) 위반이 상품 개수만큼 나고
     스크린리더 링크 목록에 이름 없는 링크가 하나씩 더 쌓인다. */
  it('keeps the nameless image link out of the accessibility tree', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} />);

    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(2);

    const [imageLink, nameLink] = links;
    /* aria-hidden 안에 초점 가능한 요소를 남기면 그 자체가 위반이다. */
    expect(imageLink[1]).toContain('aria-hidden="true"');
    expect(imageLink[1]).toContain('tabindex="-1"');

    expect(nameLink[1]).not.toContain('aria-hidden');
    expect(nameLink[1]).not.toContain('tabindex');
    expect(nameLink[2].replace(/<[^>]*>/g, '')).toContain('아크릴 블록');
  });

  /* 위시 하트가 링크 안에 들어가면 클릭 한 번이 상세 이동까지 같이 일으키고,
     링크 안의 버튼은 마크업으로도 잘못됐다. action 슬롯은 이미지 링크 다음 형제라
     GoodsCard 처럼 '마지막 </a> 뒤'로는 못 재고, 어떤 <a> 안에도 없어야 한다로 잰다. */
  it('keeps the action slot outside every link', () => {
    const html = renderToStaticMarkup(
      <ProductCard {...card} action={<button type="button">위시</button>} />,
    );

    expect(html).toContain('wc-product-card__action');
    expect(html).toContain('위시');

    const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).not.toContain('<button');
      expect(anchor).not.toContain('wc-product-card__action');
    }
  });

  /* 품절 밴드는 aria-hidden 인 이미지 링크 안에 있어 스크린리더에 닿지 않는다.
     이름 옆 sr-only '(품절)'이 그 상태를 읽어주는 유일한 지점이다(WCAG 1.3.1). */
  it('pairs the sold-out band with a screen-reader-only label', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} soldOut />);

    expect(html).toContain('wc-product-card__soldout');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('<span class="wc-sr-only"> (품절)</span>');

    const imageLink = html.match(/<a\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
    expect(imageLink).toContain('SOLD OUT');
    expect(imageLink).not.toContain('wc-sr-only');
  });

  it('omits the sold-out band and label when the product is in stock', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} />);

    expect(html).not.toContain('wc-product-card__soldout');
    expect(html).not.toContain('품절');
  });

  /* 배지는 판매 상태를 전하는 텍스트라 숨긴 이미지 링크 밖에 있어야 한다. */
  it('renders badges outside the links', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} badges={['신상', '한정']} />);

    const badges = html.match(/<div class="wc-product-card__badges">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(badges).toContain('<span class="wc-badge">신상</span>');
    expect(badges).toContain('<span class="wc-badge">한정</span>');
    expect(badges).not.toContain('<a ');
  });

  it('puts the image background on the inline style', () => {
    const html = renderToStaticMarkup(
      <ProductCard {...card} imageBackground="linear-gradient(#111, #222)" />,
    );

    expect(html).toContain('class="wc-product-card__image"');
    expect(html).toContain('style="background:linear-gradient(#111, #222)"');
  });

  it('renders the brand and the price block', () => {
    const html = renderToStaticMarkup(
      <ProductCard {...card} brand="ICONS" compareAtPrice={16000} />,
    );

    expect(html).toContain('<p class="wc-product-card__brand">ICONS</p>');
    expect(html).toContain('<s class="wc-price__original">₩16,000</s>');
    expect(html).toContain('₩12,000');
  });
});
