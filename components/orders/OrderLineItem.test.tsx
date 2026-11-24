import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderLineView } from '@/lib/orders/order-lines';
import { OrderLineItem } from './OrderLineItem';

function line(overrides: Partial<OrderLineView> = {}): OrderLineView {
  return {
    key: 'item-1', goodId: 'good-1', name: '아크릴 스탠드', optionName: '파랑', qty: 2, ipName: '홍실',
    thumbnail: 'url("https://cdn.example/a.webp") center / cover no-repeat', adultMasked: false,
    purchaseAmount: 18000, regularAmount: 20000, ...overrides,
  };
}

describe('OrderLineItem', () => {
  it('썸네일 · IP명 · 상품명 · 옵션 · 수량을 그린다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line()} />);

    expect(html).toContain('class="wc-order-line__ip">홍실</p>');
    expect(html).toContain('class="wc-order-line__name">아크릴 스탠드</p>');
    expect(html).toContain('class="wc-order-line__option">옵션 파랑</p>');
    expect(html).toContain('class="wc-order-line__qty">2개</p>');
    /* 썸네일은 장바구니와 같은 방식(goodsImageBackground) — 첫 이미지 레이어를 contain으로 두고 중립 배경을 깐다. */
    expect(html).toMatch(/class="wc-order-line__thumb"[^>]*style="background:[^"]*cdn\.example\/a\.webp/);
    expect(html).toContain('aria-hidden="true" class="wc-order-line__thumb"');
  });

  it('구매가격이 정가보다 낮으면 구매가격 strong과 정가 del을 sr-only 라벨과 함께 그린다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line()} />);

    expect(html).toContain('<span class="wc-sr-only">구매가격 </span><strong>₩18,000</strong><span class="wc-sr-only"> 정가 </span><del>₩20,000</del>');
  });

  it('구매가격과 정가가 같거나 정가가 없으면 숫자 하나만 그린다', () => {
    for (const html of [
      renderToStaticMarkup(<OrderLineItem line={line({ purchaseAmount: 20000, regularAmount: 20000 })} />),
      renderToStaticMarkup(<OrderLineItem line={line({ purchaseAmount: 20000, regularAmount: null })} />),
      renderToStaticMarkup(<OrderLineItem line={line({ purchaseAmount: 25000, regularAmount: 20000 })} />),
    ]) {
      expect(html).not.toContain('<del>');
      expect(html).not.toContain('정가');
      expect(html.match(/<strong>/g)).toHaveLength(1);
    }
    expect(renderToStaticMarkup(<OrderLineItem line={line({ purchaseAmount: 20000, regularAmount: 20000 })} />)).toContain('<strong>₩20,000</strong>');
  });

  it('구매가격을 모르면 가격 칸을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ purchaseAmount: null, regularAmount: null })} />);
    expect(html).not.toContain('wc-order-line__price');
  });

  it('IP명을 못 찾았으면 IP 칸을 생략한다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ ipName: null })} />);
    expect(html).not.toContain('wc-order-line__ip');
    expect(html).toContain('아크릴 스탠드');
  });

  it('옵션명이 없거나 기본 옵션이면 옵션 줄을 생략한다', () => {
    for (const optionName of [null, '', '기본 옵션']) {
      expect(renderToStaticMarkup(<OrderLineItem line={line({ optionName })} />)).not.toContain('wc-order-line__option');
    }
    /* 랜덤 판매의 마스킹된 옵션명은 그대로 보인다. */
    expect(renderToStaticMarkup(<OrderLineItem line={line({ optionName: '랜덤' })} />)).toContain('옵션 랜덤');
  });

  it('썸네일이 없으면 인라인 배경 없이 회색 빈 타일이다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ thumbnail: null })} />);
    expect(html).toContain('<span aria-hidden="true" class="wc-order-line__thumb"></span>');
  });

  it('19금 상품은 이미지 대신 19 타일과 sr-only 라벨을 그린다. 이름과 가격은 그대로다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ adultMasked: true, thumbnail: null })} />);

    expect(html).toContain('class="wc-order-line__thumb wc-order-line__thumb--adult"');
    expect(html).toContain('<span aria-hidden="true">19</span><span class="wc-sr-only">19금 상품</span>');
    expect(html).not.toContain('style=');
    expect(html).toContain('아크릴 스탠드');
    expect(html).toContain('₩18,000');
  });

  it('부분 취소: 남은 수량·남은 수량의 가격을 그리고 줄 아래에 `· N개 취소됨`을 적는다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ qty: 2, canceledQty: 1 })} />);
    expect(html).toContain('<p class="wc-order-line__qty">2개</p>');
    expect(html).toContain('<p class="wc-order-line__canceled" data-order-item-canceled="1">· 1개 취소됨</p>');
    expect(html).toContain('₩18,000');
    /* 취소 줄은 수량 줄 바로 아래에 온다. */
    expect(html.indexOf('wc-order-line__qty')).toBeLessThan(html.indexOf('wc-order-line__canceled'));
  });

  it('전부 취소되면 0개 줄과 가격 칸을 그리지 않고 `{원래 수량}개 취소됨`만 적는다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line({ qty: 0, canceledQty: 2, purchaseAmount: null, regularAmount: null })} />);
    expect(html).not.toContain('wc-order-line__qty');
    expect(html).not.toContain('0개');
    expect(html).not.toContain('wc-order-line__price');
    expect(html).toContain('<p class="wc-order-line__canceled" data-order-item-canceled="2">2개 취소됨</p>');
    /* 이름·IP명은 그대로 보인다. */
    expect(html).toContain('아크릴 스탠드');
    /* 가격 값이 남아 있어도(방어) 전부 취소된 줄은 가격을 그리지 않는다. */
    expect(renderToStaticMarkup(<OrderLineItem line={line({ qty: 0, canceledQty: 2 })} />)).not.toContain('wc-order-line__price');
  });

  it('부분 취소가 없으면 취소 줄이 없다', () => {
    expect(renderToStaticMarkup(<OrderLineItem line={line()} />)).not.toContain('취소됨');
    expect(renderToStaticMarkup(<OrderLineItem line={line({ canceledQty: 0 })} />)).not.toContain('취소됨');
  });

  it('줄 아래 부가 정보(children)를 본문 안에 그린다', () => {
    const html = renderToStaticMarkup(<OrderLineItem line={line()}><p className="extra">· 1개 취소됨</p></OrderLineItem>);
    expect(html).toContain('<p class="extra">· 1개 취소됨</p>');
    expect(html.indexOf('wc-order-line__qty')).toBeLessThan(html.indexOf('class="extra"'));
  });
});
