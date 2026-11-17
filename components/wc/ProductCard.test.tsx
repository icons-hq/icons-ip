import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductCard } from './ProductCard';

const card = {
  href: '/shop/g13',
  name: '아크릴 블록',
  price: 12000,
};

describe('ProductCard', () => {
  it.each([['scheduled', '판매 시작 전'], ['ended', '판매 종료']] as const)('keeps %s browseable and labels the sale period before stock', (state, label) => {
    const html = renderToStaticMarkup(<ProductCard {...card} soldOut salePeriod={{ state, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt: null }} />);
    expect(html).toContain('href="/shop/g13"'); expect(html).toContain(`>${label}</span>`); expect(html).toContain(` (${label})`);
    expect(html).not.toContain('SOLD OUT'); expect(html).not.toContain('(품절)');
  });
  it('carries hidden discount display into its price block', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} price={9000} compareAtPrice={12000} showDiscountRate={false} />);
    expect(html).toContain('₩9,000');
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('wc-price__rate');
  });
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

  /* 칩은 판매 상태를 전하는 텍스트라 숨긴 이미지 링크 밖에 있어야 한다. 넘긴 배지는 운영 배지('tag') 칩으로 바뀐다. */
  it('draws legacy badges as tag chips outside the links', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} badges={['신상', '한정']} />);

    const chips = html.match(/<div class="wc-product-card__chips">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(chips).toContain('<span class="wc-x-chip wc-x-chip--tag">신상</span>');
    expect(chips).toContain('<span class="wc-x-chip wc-x-chip--tag">한정</span>');
    expect(chips).not.toContain('<a ');
    expect(html).not.toContain('wc-product-card__badges');
    expect(html).not.toContain('class="wc-badge');
  });

  /* 할인은 가격 줄의 할인율이 대신하므로 SALE 은 칩으로 그리지 않는다(Figma). 저장 배지(NEW·EXCLUSIVE)는 남는다. */
  it('drops the derived SALE badge and keeps stored badges as tag chips', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} badges={['NEW', 'SALE']} compareAtPrice={16000} />);

    expect(html).toContain('<span class="wc-x-chip wc-x-chip--tag">NEW</span>');
    expect(html).not.toContain('>SALE<');
    expect(html).toContain('<span class="wc-price__rate">25%</span>');

    expect(renderToStaticMarkup(<ProductCard {...card} badges={['SALE']} />)).not.toContain('wc-product-card__chips');
  });

  /* 가격 아래 한 줄 — 칩 종류마다 클래스가 갈리고 순서는 넘긴 그대로다. 별점은 칩 줄 아래로 간다. */
  it('draws the chip row under the price in the given order and keeps the rating below it', () => {
    const html = renderToStaticMarkup(
      <ProductCard
        {...card}
        chips={[
          { kind: 'preorder', label: '예약판매' },
          { kind: 'freeShipping', label: '무료배송' },
          { kind: 'random', label: '캡슐토이' },
          { kind: 'tag', label: 'NEW' },
        ]}
        reviewSummary={{ count: 2, average: 5 }}
      />,
    );
    const chips = html.match(/<div class="wc-product-card__chips">[\s\S]*?<\/div>/)?.[0] ?? '';

    expect(chips).toBe(
      '<div class="wc-product-card__chips">'
      + '<span class="wc-x-chip wc-x-chip--preorder">예약판매</span>'
      + '<span class="wc-x-chip wc-x-chip--freeShipping">무료배송</span>'
      + '<span class="wc-x-chip wc-x-chip--random">캡슐토이</span>'
      + '<span class="wc-x-chip wc-x-chip--tag">NEW</span>'
      + '</div>',
    );
    expect(html.indexOf('wc-price')).toBeLessThan(html.indexOf('wc-product-card__chips'));
    expect(html.indexOf('wc-product-card__chips')).toBeLessThan(html.indexOf('wc-product-card__rating'));
  });

  /* chips 를 넘기면 badges 는 쓰지 않는다 — 호출부가 productCardChips 로 이미 정한 값이다. */
  it('prefers explicit chips over legacy badges and omits an empty chip row', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} badges={['EXCLUSIVE']} chips={[{ kind: 'freeShipping', label: '무료배송' }]} />);

    expect(html).toContain('wc-x-chip--freeShipping');
    expect(html).not.toContain('EXCLUSIVE');

    expect(renderToStaticMarkup(<ProductCard {...card} chips={[]} badges={['NEW']} />)).not.toContain('wc-product-card__chips');
    expect(renderToStaticMarkup(<ProductCard {...card} />)).not.toContain('wc-product-card__chips');
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
    expect(html).toContain('₩12,000');
  });

  /* 카드는 한 줄 가격이다 — 취소선 정가 없이 할인율과 판매가만 그린다(PriceBlock variant="inline"). */
  it('draws the card price as one line without the struck original', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} price={9000} compareAtPrice={12000} />);

    expect(html).toContain('wc-price wc-price--inline');
    expect(html).toContain('<span class="wc-price__rate">25%</span>');
    expect(html).toContain('<span class="wc-price__amount">₩9,000</span>');
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('₩12,000');
    expect(renderToStaticMarkup(<ProductCard {...card} price={9000} priceMax={12000} compareAtPrice={15000} />)).toContain('₩9,000 ~ ₩12,000');
  });

  /* CL-02: 리뷰가 있으면 가격 아래 별 다섯 칸 + (리뷰 수). 별 문자는 읽지 않고 숨은 문장을 읽는다. */
  it('shows the list rating under the price only when public reviews exist', () => {
    const html = renderToStaticMarkup(<ProductCard {...card} reviewSummary={{ count: 12, average: 4.33 }} />);
    const rating = html.match(/<p class="wc-product-card__rating">[\s\S]*?<\/p>/)?.[0] ?? '';

    expect(rating).toContain('<span aria-hidden="true" class="wc-product-card__stars">★★★★<span class="wc-product-card__stars-empty">★</span></span>');
    expect(rating).toContain('<span aria-hidden="true" class="wc-product-card__rating-count">(12)</span>');
    expect(rating).toContain('<span class="wc-sr-only">평점 5점 만점에 4.3점, 리뷰 12개</span>');
    expect(html.indexOf('wc-price')).toBeLessThan(html.indexOf('wc-product-card__rating'));

    expect(renderToStaticMarkup(<ProductCard {...card} />)).not.toContain('wc-product-card__rating');
    expect(renderToStaticMarkup(<ProductCard {...card} reviewSummary={{ count: 0, average: 0 }} />)).not.toContain('wc-product-card__rating');
  });

  /* 19금 가림 카드(ADR-0024): 인증 전에는 실제 이미지·배지·별점 대신 19 표시와 안내만 그린다.
     찜 하트는 넘긴 곳(위시)에서만 그리고, 다른 카드처럼 링크 밖에 둔다. */
  it('draws the adult masked card without the real image, badges or rating', () => {
    const html = renderToStaticMarkup(
      <ProductCard {...card} badges={['NEW']} chips={[{ kind: 'random', label: '캡슐토이' }]} imageBackground="url(/generated/goods/g11.png)" masked name="19금 굿즈" reviewSummary={{ count: 3, average: 5 }} />,
    );
    expect(html).toContain('wc-product-card--masked');
    expect(html).toContain('>19</span>');
    expect(html).toContain('성인 인증 후 볼 수 있어요');
    expect(html).toContain('₩12,000');
    expect(html).not.toContain('/generated/goods/g11.png');
    expect(html).not.toContain('wc-product-card__chips');
    expect(html).not.toContain('wc-product-card__rating');
    expect(html).not.toContain('wc-product-card__action');

    const withHeart = renderToStaticMarkup(
      <ProductCard {...card} action={<button type="button">위시</button>} masked name="19금 굿즈" />,
    );
    expect(withHeart).toContain('wc-product-card__action');
    for (const anchor of withHeart.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)) expect(anchor[0]).not.toContain('<button');
  });
});
