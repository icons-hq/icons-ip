import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import type { GoodsVariantSupply } from '@/lib/goods-preorders';
import { AddToCartButton } from './AddToCartButton';

const mocks = vi.hoisted(() => ({ add: vi.fn(), getQuantity: vi.fn(() => 0) }));
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({ ...mocks, pending: false, ready: true }) }));
const option = { id: '00000000-0000-4000-8000-000000000001', name: '파랑', code: 'BLUE', price: 1000, stockQty: 2, isDefault: true, attributes: {} };
const good: Good = { id: 'good', ip: 'ip', name: '키링', price: 1000, stockQty: 99, stock: 'ok', badge: null, img: 'none', options: [option] };
beforeEach(() => vi.clearAllMocks());

describe('찜 목록 담기', () => {
  it.each([['scheduled', '판매 예정'], ['ended', '판매 종료']] as const)('does not offer cart or option entry while %s', (state, label) => {
    const closed = { ...good, options: [option, { ...option, id: '00000000-0000-4000-8000-000000000002' }], salePeriod: { state, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt: null } };
    const html = renderToStaticMarkup(<AddToCartButton good={closed} />); expect(html).toContain('disabled=""'); expect(html).toContain(`>${label}</button>`); expect(html).not.toContain('옵션 선택'); expect(html).not.toContain('품절');
  });
  it('단일 옵션의 UUID와 재고로 담고 상품 집계 재고를 사용하지 않는다', () => {
    const button = AddToCartButton({ good });
    expect(mocks.getQuantity).toHaveBeenCalledWith('good', option.id);
    (button.props as { onClick: () => void }).onClick();
    expect(mocks.add).toHaveBeenCalledWith('good', 2, option.id);
  });
  it('여러 옵션은 상세 선택으로 연결하고 옵션이 없는 상품은 담을 수 없다', () => {
    const multiple = { ...good, options: [option, { ...option, id: '00000000-0000-4000-8000-000000000002', name: '빨강' }] };
    expect(renderToStaticMarkup(<AddToCartButton good={multiple} />)).toContain('href="/shop/good"');
    expect(renderToStaticMarkup(<AddToCartButton good={multiple} />)).toContain('옵션 선택');
    expect(renderToStaticMarkup(<AddToCartButton good={{ ...good, options: [] }} />)).toContain('disabled=""');
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('최소 수량이 한 개보다 큰 상품은 상세 수량 선택으로 연결한다', () => {
    const html = renderToStaticMarkup(<AddToCartButton good={{ ...good, orderQuantityLimitEnabled: true, minOrderQty: 2 }} />);
    expect(html).toContain('href="/shop/good"'); expect(html).toContain('수량 선택'); expect(mocks.add).not.toHaveBeenCalled();
  });
});

/* 10/14 회의 S14 — '담김'이 생소하다는 지적에 따라 이미 담은 굿즈는 장바구니 기준으로 말한다. */
describe('담은 상품 표시', () => {
  it('shows the cart quantity with the cart wording instead of 담김', () => {
    mocks.getQuantity.mockReturnValueOnce(1);
    const html = renderToStaticMarkup(<AddToCartButton good={good} />);
    expect(html).toContain('>장바구니 · 1</button>');
    expect(html).not.toContain('담김');
    expect(html).toContain('aria-label="키링, 장바구니 1개, 한 개 더 담기"');
  });
});


/* D5② 랜덤 판매·D7② 옵션별 구매 제한. */
describe('랜덤 판매·옵션별 구매 제한 담기', () => {
  it('랜덤 판매 상품은 접힌 기본 옵션 키 하나라 목록에서 바로 담는다', () => {
    const random = { ...option, name: '랜덤', code: '', attributes: {}, stockQty: 6, orderMaxQty: null, memberMaxQty: null };
    const html = renderToStaticMarkup(<AddToCartButton good={{ ...good, optionSaleMode: 'random', options: [random] }} />);
    expect(html).not.toContain('옵션 선택');
    expect(html).toContain('>담기</button>');
  });
  it('옵션별 주문당 최대 수량까지 담으면 더 담지 않는다', () => {
    mocks.getQuantity.mockReturnValue(2);
    const html = renderToStaticMarkup(<AddToCartButton good={{ ...good, options: [{ ...option, stockQty: 5, orderMaxQty: 2 }] }} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="키링, 장바구니 2개, 구매 한도 2개"');
    mocks.getQuantity.mockReturnValue(0);
  });
});

/* 접수 전 예약판매는 재고 0으로 읽혀도 '품절'이 아니다 — 같은 카드의 덮개·상세와 같은 문구로 막는다(2026-11-23 운영 홈 SOLD OUT 후속). */
describe('예약판매 담기', () => {
  const supply = (state: 'scheduled' | 'open', availableQty: number): GoodsVariantSupply => ({
    mode: 'preorder', availableQty, policyId: '11111111-1111-4111-8111-111111111111', policyRevision: 1, state,
    startsAt: '2026-12-02T02:00:00.000Z', endsAt: '2026-12-13T14:59:59.000Z', expectedShipDate: '2026-12-14',
    calculatedAt: state === 'scheduled' ? '2026-11-23T00:00:00.000Z' : '2026-12-03T00:00:00.000Z',
    nextChangeAt: state === 'scheduled' ? '2026-12-02T02:00:00.000Z' : '2026-12-13T14:59:59.000Z',
  });
  const preorder = (state: 'scheduled' | 'open', availableQty: number, optionCount = 1): Good => ({
    ...good, stockQty: availableQty * optionCount, stock: availableQty > 0 ? 'ok' : 'soldout',
    options: Array.from({ length: optionCount }, (_, index) => ({ ...option, id: `00000000-0000-4000-8000-00000000000${index + 1}`, isDefault: index === 0,
      stockQty: availableQty, supply: supply(state, availableQty) })),
  });

  it('labels a single-option preorder before reception instead of 품절, for sight and screen readers', () => {
    const html = renderToStaticMarkup(<AddToCartButton good={preorder('scheduled', 0)} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('>판매 예정</button>');
    expect(html).toContain('aria-label="키링 판매 예정"');
    expect(html).not.toContain('품절');
  });

  it('blocks a multi-option preorder before reception with the same label instead of 옵션 선택', () => {
    const html = renderToStaticMarkup(<AddToCartButton good={preorder('scheduled', 0, 2)} />);
    expect(html).toContain('>판매 예정</button>');
    expect(html).not.toContain('옵션 선택');
    expect(html).not.toContain('품절');
  });

  it('adds normally once reception opens', () => {
    const html = renderToStaticMarkup(<AddToCartButton good={preorder('open', 30)} />);
    expect(html).toContain('>담기</button>');
    expect(html).not.toContain('disabled=""');
    expect(renderToStaticMarkup(<AddToCartButton good={preorder('open', 30, 2)} />)).toContain('옵션 선택');
  });

  it('still says 품절 for a sold-out stock good and names the sale period in the accessible name', () => {
    expect(renderToStaticMarkup(<AddToCartButton good={{ ...good, stockQty: 0, stock: 'soldout', options: [{ ...option, stockQty: 0 }] }} />)).toContain('>품절</button>');
    const scheduled = { state: 'scheduled' as const, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt: '2026-10-14T00:00:00Z' };
    expect(renderToStaticMarkup(<AddToCartButton good={{ ...good, salePeriod: scheduled }} />)).toContain('aria-label="키링 판매 예정"');
  });
});
