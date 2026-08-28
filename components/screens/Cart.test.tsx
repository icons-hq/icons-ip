import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { Good } from '@/lib/data';
import { Cart } from './Cart';

const mocks = vi.hoisted(() => ({ items: [] as CartItem[] }));

vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({
    items: mocks.items,
    count: mocks.items.reduce((total, item) => total + item.qty, 0),
    ready: true,
    mode: 'server' as const,
    pending: false,
    error: null,
    getQuantity: () => 0,
    add: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    resetForSignOut: vi.fn(),
  }),
}));

const goods: Good[] = [
  {
    id: 'g13',
    name: '홍실 아크릴 블록',
    ip: 'hong-sil-quest',
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 20,
    img: 'none',
  },
  {
    id: 'g14',
    name: '품절된 키링',
    ip: 'hong-sil-quest',
    type: '키링',
    price: 9000,
    badge: null,
    stock: 'soldout',
    stockQty: 0,
    img: 'none',
  },
];

function render(items: CartItem[]) {
  mocks.items = items;
  return renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} />);
}

describe('Cart 배송비 요약', () => {
  it('임계 미달이면 실제 배송비를 붙이고 남은 금액을 안내한다', () => {
    const html = render([{ goodId: 'g13', qty: 1 }]);

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
    expect(html).toContain('38,000원 더 담으면 무료배송이에요.');
  });

  it('임계에 도달하면 배송비를 받지 않고 안내를 감춘다', () => {
    const html = render([{ goodId: 'g13', qty: 5 }]);

    expect(html).toContain('₩60,000');
    expect(html).toContain('무료');
    expect(html).not.toContain('더 담으면');
  });
});

describe('Cart 주문 요약 테이블', () => {
  const html = render([{ goodId: 'g13', qty: 1 }]);

  it('금액 행을 표로 세운다', () => {
    expect(html).toContain('총 굿즈 금액');
    expect(html).toContain('총 할인 금액');
    expect(html).toContain('−₩0');
    expect(html).toContain('배송비');
    expect(html).toContain('예상 총액');
    expect(html).toContain('배송비는 결제 화면에서 확인할 수 있어요.');
  });

  it('쿠폰 자리를 남겨두되 동작은 걸지 않는다', () => {
    expect(html).toContain('wc-cart__coupon-slot');
    expect(html).toContain('쿠폰 적용은 곧 열려요.');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('쿠폰 적용</button>');
  });

  it('주문 CTA에 담긴 수량을 싣는다', () => {
    expect(html).toContain('1개 굿즈 주문하기');
    expect(html).toContain('href="/checkout"');
  });
});

describe('Cart 라인 상태', () => {
  it('카탈로그에서 사라진 굿즈는 판매 종료로 두고 주문을 막는다', () => {
    const html = render([{ goodId: 'gone', qty: 1 }]);

    expect(html).toContain('판매 종료');
    expect(html).toContain('주문할 수 없는 굿즈 1개');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/checkout"');
  });

  it('품절 라인은 수량 스테퍼 없이 상태만 알린다', () => {
    const html = render([{ goodId: 'g14', qty: 1 }]);

    expect(html).toContain('품절');
    expect(html).not.toContain('wc-stepper');
    expect(html).toContain('품절된 키링 장바구니에서 삭제');
  });

  it('구매 가능한 라인은 수량 스테퍼와 재고 상한을 준다', () => {
    const html = render([{ goodId: 'g13', qty: 2 }]);

    expect(html).toContain('wc-stepper');
    expect(html).toContain('홍실 아크릴 블록 수량');
    expect(html).toContain('href="/shop/g13"');
  });
});

describe('Cart 빈 상태', () => {
  it('굿즈샵으로 돌려보낸다', () => {
    const html = render([]);

    expect(html).toContain('장바구니가 비어 있어요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-cart__summary');
  });
});
