import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchResultsHref } from '@/components/screens/Search';
import { shopQueryString } from '@/components/shop/collection-filters';
import {
  LISTING_RETURN_FALLBACK,
  LISTING_RETURN_STORAGE_KEY,
  isListingReturnPath,
  listingReturnEntry,
  listingReturnHref,
  listingReturnLabel,
  listingStateKeys,
  readListingReturnHref,
  rememberListingReturnEntry,
  type ListingReturnStorage,
} from './listing-return';
import type { ShopListQuery } from './shop-catalog';

/* 빈 장바구니의 둘러보기 = 직전에 보던 굿즈 목록(10/14 S17 셋째 기준 · LFS 패리티 2차 L9 CT-02).
 * 저장소는 누구나 쓸 수 있으니 읽을 때 다시 판정한다 — 외부·열린 리디렉션 금지, 내부 굿즈 목록만, 없으면 /shop. */

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: ListingReturnStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  return { storage, values };
}

const params = (query = '') => new URLSearchParams(query);

describe('굿즈 목록 화면 판정', () => {
  it('굿즈샵·NEW·BEST·검색 결과·IP관은 목록이다', () => {
    expect(isListingReturnPath('/shop', params())).toBe(true);
    expect(isListingReturnPath('/shop', params('category=11111111-1111-4111-8111-111111111111&sort=price_asc'))).toBe(true);
    expect(isListingReturnPath('/shop', params('displayCategory=abc'))).toBe(true);
    expect(isListingReturnPath('/shop/new', params())).toBe(true);
    expect(isListingReturnPath('/shop/best', params())).toBe(true);
    expect(isListingReturnPath('/search', params('q=키링'))).toBe(true);
    expect(isListingReturnPath('/ip/hong-sil-quest', params())).toBe(true);
  });

  it('굿즈 상세·검색어 없는 검색·IP 디렉토리·독립 팝업·홈·장바구니는 목록이 아니다', () => {
    expect(isListingReturnPath('/shop/g13', params())).toBe(false);
    expect(isListingReturnPath('/search', params())).toBe(false);
    expect(isListingReturnPath('/search', params('q=%20%20'))).toBe(false);
    expect(isListingReturnPath('/ip', params())).toBe(false);
    expect(isListingReturnPath('/ip/aouad', params())).toBe(false);
    expect(isListingReturnPath('/ip/hong-sil-quest/extra', params())).toBe(false);
    expect(isListingReturnPath('/', params())).toBe(false);
    expect(isListingReturnPath('/cart', params())).toBe(false);
    expect(isListingReturnPath('/my/wishlist', params())).toBe(false);
  });
});

describe('남길 주소', () => {
  it('목록 경로와 필터·정렬 쿼리를 그대로 남긴다', () => {
    expect(listingReturnEntry('/shop', params('type=키링&sort=newest'))).toBe('/shop?type=%ED%82%A4%EB%A7%81&sort=newest');
    expect(listingReturnEntry('/shop/new', params())).toBe('/shop/new');
    expect(listingReturnEntry('/search', params('q=곰 인형&page=2'))).toBe('/search?q=%EA%B3%B0+%EC%9D%B8%ED%98%95&page=2');
  });

  it('유입 추적 값(icm·utm_*·gclid·fbclid)은 빼서 돌아간 화면이 다시 집계되지 않게 한다', () => {
    expect(listingReturnEntry('/shop/best', params('icm=TOKEN1234&utm_source=naver&utm_medium=cpc&gclid=x&fbclid=y'))).toBe('/shop/best');
    expect(listingReturnEntry('/shop', params('utm_campaign=fall&type=키링'))).toBe('/shop?type=%ED%82%A4%EB%A7%81');
  });

  it('목록이 아니거나 지나치게 긴 주소는 남기지 않는다', () => {
    expect(listingReturnEntry('/shop/g13', params())).toBeNull();
    expect(listingReturnEntry('/search', params(`q=${'가'.repeat(200)}`))).toBeNull();
  });

  /* l9-data-1: IP관 팔로우·알림 액션은 결과를 쿼리 플래그로 돌려준다(app/ip/actions.ts). 직전 목록이 이 플래그를 품으면
     빈 장바구니의 둘러보기가 지난 '알림 설정을 저장했습니다'·팔로우 오류 안내를 다시 띄운다. */
  it('IP관 액션 결과 플래그(notification_saved·follow_error·notification_error)는 남기지 않고 목록 상태만 남긴다', () => {
    expect(listingReturnEntry('/ip/hong-sil-quest', params('category=abc&notification_saved=1'))).toBe('/ip/hong-sil-quest?category=abc');
    expect(listingReturnEntry('/ip/hong-sil-quest', params('follow_error=1'))).toBe('/ip/hong-sil-quest');
    expect(listingReturnEntry('/ip/hong-sil-quest', params('notification_error=1&sort=price_asc&min=1000'))).toBe('/ip/hong-sil-quest?sort=price_asc&min=1000');
  });

  it('화면마다 그 화면이 읽는 목록 상태 키만 남긴다 — 모르는 키·다른 화면의 키는 버린다', () => {
    expect(listingReturnEntry('/shop', params('displayCategory=d1&type=a&foo=1&page=3'))).toBe('/shop?displayCategory=d1&type=a');
    expect(listingReturnEntry('/shop/new', params('displayCategory=d1&ip=i1&sort=price_asc'))).toBe('/shop/new?ip=i1&sort=price_asc');
    expect(listingReturnEntry('/shop/best', params('q=키링&max=5000'))).toBe('/shop/best?max=5000');
    expect(listingReturnEntry('/search', params('q=곰&ip=i1&type=a&page=2&notification_saved=1'))).toBe('/search?q=%EA%B3%B0&ip=i1&type=a&page=2');
    /* IP관은 스코프가 이미 IP 하나다 — ip 필터는 목록 상태가 아니다(app/ip/[id]/page.tsx). */
    expect(listingReturnEntry('/ip/hong-sil-quest', params('ip=other&type=a'))).toBe('/ip/hong-sil-quest?type=a');
  });

  it('같은 키가 여러 번 오면(다중 선택 필터) 순서대로 모두 남긴다', () => {
    expect(listingReturnEntry('/shop', params('type=a&icm=T&type=b&ip=i1'))).toBe('/shop?type=a&type=b&ip=i1');
  });
});

/* 목록 상태 키 목록이 화면 파서·컨트롤과 어긋나면 돌아간 목록이 필터를 잃는다 — 컨트롤이 실제로 만드는 주소와 대조한다. */
describe('목록 상태 키 계약', () => {
  const keysOf = (href: string) => [...new Set([...new URL(href, 'https://icons.invalid').searchParams.keys()])];
  const fullQuery = (view: ShopListQuery['view'], extra: Partial<ShopListQuery> = {}): ShopListQuery => ({
    ips: ['i1'], categories: ['c1'], types: ['키링'], priceMin: 1000, priceMax: 9000, sort: 'price_desc', view, ...extra,
  });

  it('굿즈샵·NEW·BEST·전시 카테고리 컨트롤(shopQueryString)이 만드는 주소는 그대로 남는다', () => {
    const cases = [
      ['/shop', fullQuery('all')],
      ['/shop/new', fullQuery('new')],
      ['/shop/best', fullQuery('best')],
      /* 전시 카테고리는 레거시 category 와 함께 오지 않는다(parseCategoryDisplayRequest). */
      ['/shop', fullQuery('all', { displayCategory: 'd1', categories: [] })],
    ] as const;
    for (const [pathname, query] of cases) {
      const href = `${pathname}?${shopQueryString(query)}`;
      expect(keysOf(href).length).toBeGreaterThanOrEqual(6);
      expect(listingReturnEntry(pathname, new URL(href, 'https://icons.invalid').searchParams)).toBe(href);
    }
  });

  it('검색 결과 주소(searchResultsHref — 검색어·필터·페이지)는 그대로 남는다', () => {
    const href = searchResultsHref('곰 인형', fullQuery('search', { sort: 'price_asc' }), 3);
    expect(keysOf(href)).toEqual(['q', 'category', 'ip', 'type', 'min', 'max', 'sort', 'page']);
    expect(listingReturnEntry('/search', new URL(href, 'https://icons.invalid').searchParams)).toBe(
      `/search?${new URL(href, 'https://icons.invalid').searchParams.toString()}`,
    );
  });

  it('IP관 키는 정본 페이지의 COLLECTION_PARAMS 와 같고, 액션 결과 플래그는 들지 않는다', () => {
    const page = readFileSync(new URL('../app/ip/[id]/page.tsx', import.meta.url), 'utf8');
    const collection = page.match(/const COLLECTION_PARAMS = \[([^\]]+)\] as const/)?.[1];
    const flags = page.match(/for \(const key of \[([^\]]+)\] as const\)/)?.[1];
    const literals = (source: string | undefined) => [...(source ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect(literals(collection)).toEqual(['category', 'type', 'min', 'max', 'sort']);
    expect(listingStateKeys('/ip/hong-sil-quest', params())).toEqual(literals(collection));
    expect(literals(flags)).toEqual(['follow_error', 'notification_error', 'notification_saved']);
    for (const flag of literals(flags)) expect(listingStateKeys('/ip/hong-sil-quest', params())).not.toContain(flag);
  });
});

describe('돌아갈 주소 판정', () => {
  it('저장된 굿즈 목록 주소는 그대로 돌려준다', () => {
    expect(listingReturnHref('/shop?type=%ED%82%A4%EB%A7%81&sort=newest')).toBe('/shop?type=%ED%82%A4%EB%A7%81&sort=newest');
    expect(listingReturnHref('/search?q=%EA%B3%B0')).toBe('/search?q=%EA%B3%B0');
    expect(listingReturnHref('/ip/hong-sil-quest')).toBe('/ip/hong-sil-quest');
  });

  it('값이 없으면 굿즈샵으로 보낸다', () => {
    expect(listingReturnHref(null)).toBe(LISTING_RETURN_FALLBACK);
    expect(listingReturnHref(undefined)).toBe(LISTING_RETURN_FALLBACK);
    expect(listingReturnHref('')).toBe('/shop');
  });

  it.each([
    'https://evil.example/shop',
    '//evil.example/shop',
    '/\\evil.example/shop',
    '/\t/evil.example/shop',
    'javascript:alert(1)',
    ' /shop',
    'shop',
  ])('외부·스킴·프로토콜 상대 주소는 굿즈샵으로 접는다: %s', (stored) => {
    expect(listingReturnHref(stored)).toBe('/shop');
  });

  it('같은 출처라도 목록이 아닌 경로·점 경로로 빠져나가는 값은 굿즈샵으로 접는다', () => {
    expect(listingReturnHref('/admin')).toBe('/shop');
    expect(listingReturnHref('/checkout')).toBe('/shop');
    expect(listingReturnHref('/shop/../admin')).toBe('/shop');
    expect(listingReturnHref('/shop/g13')).toBe('/shop');
    expect(listingReturnHref(`/shop?q=${'a'.repeat(600)}`)).toBe('/shop');
  });

  it('해시는 버리고 추적 값도 다시 걸러 낸다', () => {
    expect(listingReturnHref('/shop/new#top')).toBe('/shop/new');
    expect(listingReturnHref('/shop?icm=TOKEN1234&type=a')).toBe('/shop?type=a');
  });

  it('이전 판에 남은 값의 결과 플래그도 읽을 때 걸러 내 재생하지 않는다', () => {
    expect(listingReturnHref('/ip/hong-sil-quest?notification_saved=1')).toBe('/ip/hong-sil-quest');
    expect(listingReturnHref('/ip/hong-sil-quest?follow_error=1&type=a')).toBe('/ip/hong-sil-quest?type=a');
  });
});

/* l9-ui-3: 둘러보기의 목적지가 직전 목록으로 바뀌므로 문구도 그 목적지 표면을 말해야 한다(WCAG 2.4.4 · CONTEXT.md). */
describe('둘러보기 문구', () => {
  it('목적지 표면을 말한다 — 굿즈샵·NEW·BEST = 굿즈샵, IP관 = 온라인 팝업, 검색 결과 = 검색 결과', () => {
    expect(listingReturnLabel('/shop')).toBe('굿즈샵 둘러보기');
    expect(listingReturnLabel('/shop?displayCategory=d1&type=a')).toBe('굿즈샵 둘러보기');
    expect(listingReturnLabel('/shop/new?sort=price_asc')).toBe('굿즈샵 둘러보기');
    expect(listingReturnLabel('/shop/best')).toBe('굿즈샵 둘러보기');
    expect(listingReturnLabel('/ip/maplestory')).toBe('온라인 팝업 둘러보기');
    expect(listingReturnLabel('/ip/maplestory?type=a')).toBe('온라인 팝업 둘러보기');
    expect(listingReturnLabel('/search?q=%ED%82%A4%EB%A7%81')).toBe('검색 결과 둘러보기');
  });

  it('판정한 목적지와 같은 값에서 문구를 고른다 — 거절된 저장값은 굿즈샵 주소와 굿즈샵 문구', () => {
    for (const stored of [null, 'https://evil.example/ip/x', '//evil.example/search?q=a', '/my', '/search']) {
      const href = listingReturnHref(stored);
      expect([href, listingReturnLabel(href)]).toEqual(['/shop', '굿즈샵 둘러보기']);
    }
    const ip = listingReturnHref('/ip/hong-sil-quest?notification_saved=1');
    expect([ip, listingReturnLabel(ip)]).toEqual(['/ip/hong-sil-quest', '온라인 팝업 둘러보기']);
  });
});

describe('세션 저장소 읽고 쓰기', () => {
  /* 목록이 아닌 화면·그리지 못한 화면이 직전 목록을 덮지 않는 것은 셸 기록기가 지킨다(ListingReturn.client.test). */
  it('판정한 목록 주소를 남기고, 읽을 때 다시 판정해 돌려준다', () => {
    const { storage, values } = memoryStorage();
    rememberListingReturnEntry(storage, listingReturnEntry('/search', params('q=키링'))!);
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/search?q=%ED%82%A4%EB%A7%81');
    expect(readListingReturnHref(storage)).toBe('/search?q=%ED%82%A4%EB%A7%81');

    rememberListingReturnEntry(storage, '/shop/best');
    expect(readListingReturnHref(storage)).toBe('/shop/best');
  });

  it('누군가 저장소에 외부 주소를 넣어도 굿즈샵으로 읽는다', () => {
    const { storage } = memoryStorage({ [LISTING_RETURN_STORAGE_KEY]: '//evil.example' });
    expect(readListingReturnHref(storage)).toBe('/shop');
  });

  it('저장소가 없거나 막혀 있으면 조용히 굿즈샵으로 돌아간다', () => {
    const blocked: ListingReturnStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => rememberListingReturnEntry(blocked, '/shop')).not.toThrow();
    expect(readListingReturnHref(blocked)).toBe('/shop');
    expect(() => rememberListingReturnEntry(null, '/shop')).not.toThrow();
    expect(readListingReturnHref(null)).toBe('/shop');
  });
});
