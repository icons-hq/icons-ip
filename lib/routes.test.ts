import { describe, expect, it } from 'vitest';
import {
  MOB_ITEMS,
  NAV_ITEMS,
  UTIL_ITEMS,
  activeNavId,
  hrefFor,
  isActive,
  isAuthShellPath,
} from './routes';

describe('ticket routes', () => {
  it('maps and activates the protected my-tickets surface', () => {
    expect(hrefFor('tickets')).toBe('/tickets');
    expect(isActive('tickets', '/tickets')).toBe(true);
    expect(isActive('tickets', '/tickets/5cbcbfed-202d-4676-821a-7706398e57c0')).toBe(true);
  });
});

describe('account routes', () => {
  it('maps and activates the protected my hub', () => {
    expect(hrefFor('my')).toBe('/my');
    expect(isActive('my', '/my')).toBe(true);
    expect(isActive('my', '/my/preferences')).toBe(true);
    expect(isActive('my', '/settings')).toBe(false);
  });

  it('maps and activates the protected notification inbox and settings surface', () => {
    expect(hrefFor('notifications')).toBe('/notifications');
    expect(isActive('notifications', '/notifications')).toBe(true);
    expect(isActive('notifications', '/notifications/settings')).toBe(true);
    expect(isActive('notifications', '/settings')).toBe(false);
  });
});

describe('legal routes', () => {
  it('maps the three public legal notices', () => {
    expect(hrefFor('terms')).toBe('/legal/terms');
    expect(hrefFor('privacy')).toBe('/legal/privacy');
    expect(hrefFor('shipping')).toBe('/legal/shipping');
  });

  it('keeps legal notices outside the auth-only shell so guests can read them', () => {
    expect(isAuthShellPath('/legal/terms')).toBe(false);
  });
});

describe('isAuthShellPath', () => {
  it.each(['/login', '/update-password', '/account-suspended'])('treats %s as an auth-only shell', (pathname) => {
    expect(isAuthShellPath(pathname)).toBe(true);
  });

  it('does not hide the product shell on normal routes', () => {
    expect(isAuthShellPath('/community')).toBe(false);
  });
});

describe('White Catalog 내비게이션 경로', () => {
  it('카탈로그 진입 표면을 굿즈샵 하위 경로로 건다', () => {
    expect(hrefFor('new')).toBe('/shop/new');
    expect(hrefFor('best')).toBe('/shop/best');
  });

  it('위시와 소개 표면을 건다', () => {
    expect(hrefFor('wish')).toBe('/my/wishlist');
    expect(hrefFor('about')).toBe('/about');
  });
});

describe('내비게이션 항목 구성', () => {
  it('GNB는 계약된 7개 항목을 순서대로 유지한다', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      'new',
      'best',
      'shop',
      'iphub',
      'packs',
      'events',
      'community',
    ]);
  });

  it('모바일 탭은 홈을 가운데 둔 5개 항목이다', () => {
    expect(MOB_ITEMS.map((item) => item.id)).toEqual(['menu', 'shop', 'home', 'wish', 'my']);
    expect(MOB_ITEMS[2].id).toBe('home');
  });

  it('유틸 항목은 주문조회와 알림함이다', () => {
    expect(UTIL_ITEMS.map((item) => item.id)).toEqual(['orders', 'notifications']);
  });
});

describe('내비게이션 경로 등록 계약', () => {
  /* 미등록 id는 hrefFor가 '/'로 삼켜서 항목 전체가 홈 링크로 둔갑한다. 침묵하는 실패라 계약으로 막는다. */
  const routedItems = [...NAV_ITEMS, ...UTIL_ITEMS, ...MOB_ITEMS].filter((item) => item.id !== 'menu');

  it.each(routedItems.map((item) => [item.id] as const))('%s 항목이 홈 폴백이 아닌 경로로 해석된다', (id) => {
    const href = hrefFor(id);

    expect(href.startsWith('/')).toBe(true);
    /* 'home'만 '/'가 정답이다. */
    if (id !== 'home') expect(href).not.toBe('/');
  });

  it('메뉴 탭은 목적지가 없어 홈으로 폴백된다', () => {
    expect(hrefFor('menu')).toBe('/');
  });
});

describe('activeNavId', () => {
  it('하위 경로에서 상위 카테고리가 아니라 가장 특정한 항목을 고른다', () => {
    expect(activeNavId('/shop/new')).toBe('new');
    expect(activeNavId('/shop/best')).toBe('best');
  });

  it('카테고리 목록과 상품 상세에서는 카테고리를 고른다', () => {
    expect(activeNavId('/shop')).toBe('shop');
    expect(activeNavId('/shop/g3')).toBe('shop');
  });

  it('GNB에 홈이 없으므로 루트에서는 아무것도 고르지 않는다', () => {
    expect(activeNavId('/')).toBeNull();
  });

  it('모바일 탭 기준으로는 루트에서 홈을 고른다', () => {
    expect(activeNavId('/', MOB_ITEMS)).toBe('home');
  });

  it('경로 없는 메뉴 탭이 홈을 가로채지 않는다', () => {
    expect(activeNavId('/', [{ id: 'menu', label: '메뉴' }])).toBeNull();
  });

  it('위시 경로에서 마이가 아니라 위시를 고른다', () => {
    expect(activeNavId('/my/wishlist', MOB_ITEMS)).toBe('wish');
    expect(activeNavId('/my', MOB_ITEMS)).toBe('my');
  });

  it('매칭이 없으면 null을 돌려준다', () => {
    expect(activeNavId('/legal/terms')).toBeNull();
  });
});
