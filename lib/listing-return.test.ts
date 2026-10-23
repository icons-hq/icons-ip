import { describe, expect, it } from 'vitest';
import {
  LISTING_RETURN_FALLBACK,
  LISTING_RETURN_STORAGE_KEY,
  isListingReturnPath,
  listingReturnEntry,
  listingReturnHref,
  readListingReturnHref,
  rememberListingReturn,
  type ListingReturnStorage,
} from './listing-return';

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
});

describe('세션 저장소 읽고 쓰기', () => {
  it('목록 화면을 볼 때만 남기고, 목록이 아닌 화면은 직전 목록을 덮지 않는다', () => {
    const { storage, values } = memoryStorage();
    rememberListingReturn(storage, '/search', params('q=키링'));
    rememberListingReturn(storage, '/shop/g13', params());
    rememberListingReturn(storage, '/my', params());
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/search?q=%ED%82%A4%EB%A7%81');
    expect(readListingReturnHref(storage)).toBe('/search?q=%ED%82%A4%EB%A7%81');

    rememberListingReturn(storage, '/shop/best', params());
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
    expect(() => rememberListingReturn(blocked, '/shop', params())).not.toThrow();
    expect(readListingReturnHref(blocked)).toBe('/shop');
    expect(() => rememberListingReturn(null, '/shop', params())).not.toThrow();
    expect(readListingReturnHref(null)).toBe('/shop');
  });
});
