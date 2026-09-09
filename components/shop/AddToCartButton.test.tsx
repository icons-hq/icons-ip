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
});
