import { beforeEach, describe, expect, it, vi } from 'vitest';

/* T7 리뷰 RV-4: 상품 상세 담기·바로구매는 장바구니에 이미 담긴 수량까지 합쳐 옵션별 주문당 최대 수량(D7②)을 넘으면
   카트에 보내지 않고 확정 카피로 이유를 말한다 — 목록 담기(AddToCartButton)·위시 카드와 같은 한도다.
   jsdom 없이 훅을 얇게 흉내 내 useGoodPurchase 를 직접 부른다(선례: GoodPurchasePanel.client.test.tsx). */

const hooks = vi.hoisted(() => ({ states: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const cart = vi.hoisted(() => ({ quantities: new Map<string, number>(), addSelection: vi.fn(async () => true) }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
      };
      return [hooks.states[index], set];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useEffect: () => {},
  };
});
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ ready: true, pending: false, error: null, addSelection: cart.addSelection, refresh: vi.fn(),
    getQuantity: (goodId: string, variantId: string) => cart.quantities.get(`${goodId}:${variantId}`) ?? 0 }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/shop/g1', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import type { Good, GoodOption } from '@/lib/data';
import { purchaseBlockReason, useGoodPurchase } from './GoodPurchasePanel';

const limited: GoodOption = { id: 'a', name: '파랑', code: 'A', price: 12000, stockQty: 10, isDefault: true, attributes: {}, orderMaxQty: 2, memberMaxQty: null };
const free: GoodOption = { id: 'b', name: '빨강', code: 'B', price: 12000, stockQty: 10, isDefault: false, attributes: {}, orderMaxQty: null, memberMaxQty: null };
const good: Good = { id: 'g1', name: '키링', ip: 'ip', type: '키링', price: 12000, badge: null, stock: 'ok', stockQty: 20, img: '', options: [limited, free] };
const extraOption: GoodOption = { id: 'x', name: '기본 옵션', code: 'X', price: 3000, stockQty: 5, isDefault: true, attributes: {}, orderMaxQty: 1, memberMaxQty: null };
const extra: Good = { id: 'g2', name: '스티커', ip: 'ip', type: '스티커', price: 3000, badge: null, stock: 'ok', stockQty: 5, img: '', options: [extraOption] };

/* 훅을 부르는 자리는 컴포넌트 함수로 감싸고, 렌더마다 훅 순번을 되돌리는 일은 바깥 함수가 한다. */
function Purchase(props: Parameters<typeof useGoodPurchase>[0]) {
  return useGoodPurchase(props);
}
function render(props: Parameters<typeof useGoodPurchase>[0]) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return Purchase(props);
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  cart.quantities.clear();
  cart.addSelection.mockClear();
});

describe('purchaseBlockReason 옵션별 주문당 최대 수량', () => {
  const base = { disabled: false, soldOut: false, ready: true, pending: false, nextQuantity: 3, stockQty: 10 };
  it('담긴 수량을 합친 수량이 주문당 최대를 넘으면 limit, 재고가 더 작으면 stock 이다', () => {
    expect(purchaseBlockReason({ ...base, orderMaxQty: 2 })).toBe('limit');
    expect(purchaseBlockReason({ ...base, orderMaxQty: 3 })).toBeNull();
    expect(purchaseBlockReason({ ...base, orderMaxQty: null })).toBeNull();
    expect(purchaseBlockReason({ ...base, nextQuantity: 11, stockQty: 10, orderMaxQty: 20 })).toBe('stock');
  });
});

describe('상품 상세 담기의 옵션별 주문당 최대 수량', () => {
  it('장바구니에 한도만큼 담긴 옵션을 다시 담으면 카트에 보내지 않고 확정 카피를 보인다', async () => {
    cart.quantities.set('g1:a', 2);
    render({ good }).addToCart();
    await flush();
    expect(cart.addSelection).not.toHaveBeenCalled();
    expect(render({ good }).message).toBe("'파랑'은 한 번에 2개까지 주문할 수 있습니다.");
  });

  it('바로구매도 같은 한도에서 멈춘다', async () => {
    cart.quantities.set('g1:a', 1);
    const purchase = render({ good });
    purchase.setQuantity(2);
    render({ good }).buyNow();
    await flush();
    expect(cart.addSelection).not.toHaveBeenCalled();
    expect(render({ good }).message).toContain('한 번에 2개까지 주문할 수 있습니다.');
  });

  it('한도 안이면 그대로 담는다', async () => {
    cart.quantities.set('g1:a', 1);
    render({ good }).addToCart();
    await flush();
    expect(cart.addSelection).toHaveBeenCalledTimes(1);
  });

  it('추가 구성 굿즈도 담긴 수량을 합쳐 옵션별 한도를 넘으면 멈춘다', async () => {
    cart.quantities.set('g2:x', 1);
    render({ good, additionalGoods: [extra], initialVariantId: 'b' }).toggleAdditional?.('g2', true);
    render({ good, additionalGoods: [extra], initialVariantId: 'b' }).addToCart();
    await flush();
    expect(cart.addSelection).not.toHaveBeenCalled();
    expect(render({ good, additionalGoods: [extra], initialVariantId: 'b' }).message).toBe("'스티커'은 한 번에 1개까지 주문할 수 있습니다.");
  });
});
