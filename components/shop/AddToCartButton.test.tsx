import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import { AddToCartButton } from './AddToCartButton';

const mocks = vi.hoisted(() => ({ add: vi.fn(), getQuantity: vi.fn(() => 0) }));
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({ ...mocks, pending: false, ready: true }) }));
const option = { id: '00000000-0000-4000-8000-000000000001', name: '파랑', code: 'BLUE', price: 1000, stockQty: 2, isDefault: true, attributes: {} };
const good: Good = { id: 'good', ip: 'ip', name: '키링', type: '키링', price: 1000, stockQty: 99, stock: 'ok', badge: null, img: 'none', options: [option] };
beforeEach(() => vi.clearAllMocks());

describe('찜 목록 담기', () => {
  it.each([['scheduled', '판매 시작 전'], ['ended', '판매 종료']] as const)('does not offer cart or option entry while %s', (state, label) => {
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
describe('담은 굿즈 표시', () => {
  it('shows the cart quantity with the cart wording instead of 담김', () => {
    mocks.getQuantity.mockReturnValueOnce(1);
    const html = renderToStaticMarkup(<AddToCartButton good={good} />);
    expect(html).toContain('>장바구니 · 1</button>');
    expect(html).not.toContain('담김');
    expect(html).toContain('aria-label="키링, 장바구니 1개, 한 개 더 담기"');
  });
});

