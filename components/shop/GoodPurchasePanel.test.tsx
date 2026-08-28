import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import { activeGalleryIndex } from './PdpGallery';
import {
  GoodPurchasePanel,
  buyNowNavigation,
  isGoodSoldOut,
  isMiniBuybarVisible,
  mergedCartQuantity,
  purchaseBlockReason,
  purchaseSubtotal,
  type GoodPurchaseController,
} from './GoodPurchasePanel';

vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ error: null, getQuantity: () => 0, pending: false, ready: true, setQuantity: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g13',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/shop/RestockCta', () => ({
  RestockCta: ({ initialRequested }: { initialRequested: boolean }) => (
    <button className="wc-restock-cta" type="button">
      {initialRequested ? '재입고 알림 신청됨' : '재입고 알림 받기'}
    </button>
  ),
}));

const good: Good = {
  id: 'g13',
  name: '아크릴 블록',
  ip: 'hong-sil-quest',
  type: '아크릴',
  price: 12000,
  badge: 'NEW',
  stock: 'ok',
  stockQty: 8,
  img: 'url("https://cdn.example/g13.webp") center / cover no-repeat',
};

function controller(overrides: Partial<GoodPurchaseController> = {}): GoodPurchaseController {
  return {
    good,
    quantity: 1,
    setQuantity: vi.fn(),
    subtotal: good.price,
    soldOut: false,
    restockRequested: false,
    disabled: false,
    inert: false,
    message: null,
    addToCart: vi.fn(),
    buyNow: vi.fn(),
    ...overrides,
  };
}

describe('purchaseSubtotal', () => {
  it('수량만큼 곱한 금액을 낸다', () => {
    expect(purchaseSubtotal(12000, 3)).toBe(36000);
    expect(purchaseSubtotal(12000, 1)).toBe(12000);
  });

  /* 합계가 음수·NaN 으로 새면 "₩NaN" 이 그대로 화면에 남는다. */
  it('망가진 입력은 0으로 떨어뜨린다', () => {
    expect(purchaseSubtotal(Number.NaN, 2)).toBe(0);
    expect(purchaseSubtotal(12000, Number.NaN)).toBe(0);
    expect(purchaseSubtotal(-100, 2)).toBe(0);
    expect(purchaseSubtotal(12000, -3)).toBe(0);
  });
});

describe('mergedCartQuantity', () => {
  /* 상세에서 2개를 담고 다시 3개를 담으면 5개다 — 덮어쓰면 앞의 담기가 사라진다. */
  it('이미 담긴 수량에 더한다', () => {
    expect(mergedCartQuantity(2, 3)).toBe(5);
    expect(mergedCartQuantity(0, 1)).toBe(1);
  });

  /* 재고 상한은 카트와 DB 가 판정한다. 여기서 조용히 자르면 왜 덜 담겼는지 아무도 말하지 않는다. */
  it('재고로 자르지 않는다', () => {
    expect(mergedCartQuantity(8, 5)).toBe(13);
  });

  it('최소 한 개는 담는다', () => {
    expect(mergedCartQuantity(1, 0)).toBe(2);
    expect(mergedCartQuantity(0, -4)).toBe(1);
  });
});

describe('purchaseBlockReason', () => {
  const base = {
    disabled: false,
    soldOut: false,
    ready: true,
    pending: false,
    nextQuantity: 1,
    stockQty: 8,
  };

  it('막을 이유가 없으면 null 이다', () => {
    expect(purchaseBlockReason(base)).toBeNull();
  });

  it('미리보기·품절·준비중·저장중·재고 순으로 이유를 정한다', () => {
    expect(purchaseBlockReason({ ...base, disabled: true, soldOut: true })).toBe('disabled');
    expect(purchaseBlockReason({ ...base, soldOut: true, ready: false })).toBe('soldout');
    expect(purchaseBlockReason({ ...base, ready: false, pending: true })).toBe('not_ready');
    expect(purchaseBlockReason({ ...base, pending: true, nextQuantity: 99 })).toBe('pending');
    expect(purchaseBlockReason({ ...base, nextQuantity: 9 })).toBe('stock');
  });
});

describe('buyNowNavigation', () => {
  it('요청이 없으면 이동하지 않는다', () => {
    expect(buyNowNavigation({ requested: false, cartPending: false, cartError: null })).toBe('abort');
  });

  it('카트 반영이 끝나기 전에는 기다린다 — 클라이언트 성공 신호는 진실원이 아니다', () => {
    expect(buyNowNavigation({ requested: true, cartPending: true, cartError: null })).toBe('wait');
  });

  it('반영이 정착하고 오류가 없을 때만 체크아웃으로 간다', () => {
    expect(buyNowNavigation({ requested: true, cartPending: false, cartError: null })).toBe('navigate');
  });

  it('카트가 오류를 냈으면 이동을 접는다 — 담기지 않은 채 결제 화면에 서지 않는다', () => {
    expect(
      buyNowNavigation({ requested: true, cartPending: false, cartError: '재고 초과' }),
    ).toBe('abort');
  });
});

describe('isGoodSoldOut', () => {
  /* 품절 판정은 수량이 아니라 판매 상태다 — 운영자가 내린 굿즈는 재고가 남아도 품절이다. */
  it('판매 상태로만 판정한다', () => {
    expect(isGoodSoldOut({ stock: 'soldout' })).toBe(true);
    expect(isGoodSoldOut({ stock: 'low' })).toBe(false);
    expect(isGoodSoldOut({ stock: 'ok' })).toBe(false);
  });
});

describe('isMiniBuybarVisible', () => {
  it('하부 탭이 보일 때만, 미리보기가 아닐 때만 뜬다', () => {
    expect(isMiniBuybarVisible({ panelsInView: true, embedded: false })).toBe(true);
    expect(isMiniBuybarVisible({ panelsInView: false, embedded: false })).toBe(false);
    expect(isMiniBuybarVisible({ panelsInView: true, embedded: true })).toBe(false);
  });
});

describe('activeGalleryIndex', () => {
  it('스크롤 위치에서 가장 가까운 슬라이드를 고른다', () => {
    expect(activeGalleryIndex(0, 649, 3)).toBe(0);
    expect(activeGalleryIndex(700, 649, 3)).toBe(1);
    expect(activeGalleryIndex(1298, 649, 3)).toBe(2);
  });

  /* 마운트 직후에는 폭을 못 잰다. 0으로 나눠 NaN 인덱스를 만들면 활성 도트가 사라진다. */
  it('측정 전이거나 범위를 벗어나면 안전한 인덱스를 낸다', () => {
    expect(activeGalleryIndex(300, 0, 3)).toBe(0);
    expect(activeGalleryIndex(99999, 649, 3)).toBe(2);
    expect(activeGalleryIndex(-50, 649, 3)).toBe(0);
  });
});

describe('GoodPurchasePanel', () => {
  it('합계는 단가가 아니라 수량을 반영한 금액이다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ quantity: 3, subtotal: purchaseSubtotal(good.price, 3) })} />,
    );

    expect(html).toContain('총 금액');
    expect(html).toContain('₩36,000');
    expect(html).toContain('value="3"');
  });

  it('품절이면 CTA 쌍 대신 재입고 알림만 남는다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ good: { ...good, stock: 'soldout', stockQty: 0 }, soldOut: true })} />,
    );

    expect(html).toContain('재입고 알림 받기');
    expect(html).toContain('>품절<');
    expect(html).not.toContain('wc-buy-panel__ctas');
  });

  /* 서버 확인 전에는 "완료"라고 하지 않는다. 카트가 낸 오류가 있으면 그것이 먼저다. */
  it('상태 문구를 live region 으로 알린다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ message: '현재 재고보다 많이 담을 수 없습니다.' })} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('현재 재고보다 많이 담을 수 없습니다.');
  });
});
