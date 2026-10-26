/*
 * 직전에 보던 굿즈 목록 — 빈 장바구니의 둘러보기 버튼이 돌아갈 곳(LFS 패리티 2차 L9 CT-02 · 10/14 S17 셋째 기준).
 *
 * 셸(components/shell/ListingReturn.tsx)이 굿즈 목록 화면을 실제로 그린 뒤 그 주소를 탭 세션 저장소에 남기고,
 * 빈 장바구니가 그 값을 읽는다. 남기는 것은 그 목록의 상태(필터·정렬·검색어·페이지)뿐이다 — 화면마다 URL 이 담는
 * 목록 상태 키만 허용하므로 액션 결과 플래그(IP관 follow_error·notification_saved 등)나 유입 추적 값(icm·utm) 같은
 * 1회성 값은 남지도 재생되지도 않는다. 저장소는 같은 출처의 어떤 스크립트나 사용자도 쓸 수 있는 자리라 읽을 때
 * 다시 판정한다 — 같은 출처의 굿즈 목록 경로만 받고(외부 주소·`//`·역슬래시·목록이 아닌 경로는 거절) 실패하면
 * 굿즈샵(/shop)으로 보낸다. 그래서 이 값으로 열린 리디렉션이 생기지 않는다.
 */
import { AOUAD_POPUP_PATH } from './routes';

export const LISTING_RETURN_STORAGE_KEY = 'icons:listing-return:v1';
export const LISTING_RETURN_FALLBACK = '/shop';

/* 검색어 한두 개가 든 목록 주소는 이 길이를 넘지 않는다 — 넘으면 남기지도 받지도 않는다. */
const MAX_ENTRY_LENGTH = 512;
/* 상대 주소를 판정하려고만 쓰는 가상의 출처다 — 해석 결과가 이 출처를 벗어나면 외부 주소다. */
const RESOLVE_BASE = 'https://listing-return.invalid';

/*
 * 목록 화면별로 URL 이 담는 목록 상태 — 각 화면의 서버 파서가 읽는 키와 같다.
 * 굿즈샵·NEW·BEST 필터·정렬 = parseShopSearchParams(lib/shop-catalog), 전시 카테고리 = parseCategoryDisplayRequest
 * (lib/category-display, 굿즈샵만), 검색 = 검색어·페이지(app/search/page.tsx) + 같은 필터, IP관 = COLLECTION_PARAMS
 * (app/ip/[id]/page.tsx — 스코프가 이미 IP 하나라 ip 가 없다). 목록 상태 키가 새로 생기면 여기에도 더한다
 * (lib/listing-return.test.ts 가 컨트롤이 만드는 주소의 키와 대조한다). 빠뜨려도 목록으로는 돌아간다 — 그 상태만 잃는다.
 */
const SHOP_FILTER_KEYS = ['category', 'ip', 'type', 'min', 'max', 'sort'] as const;
const LISTING_STATE_KEYS = {
  shop: ['displayCategory', ...SHOP_FILTER_KEYS],
  collection: SHOP_FILTER_KEYS,
  search: ['q', ...SHOP_FILTER_KEYS, 'page'],
  ip: ['category', 'type', 'min', 'max', 'sort'],
} as const satisfies Record<string, readonly string[]>;

export interface ListingReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 둘러보기가 돌아갈 수 있는 굿즈 목록 화면이면 그 URL 이 담는 목록 상태 키, 아니면 null.
 * 굿즈샵(카테고리·전시 카테고리·필터 포함)·NEW·BEST, 검색 결과(검색어가 있을 때), IP관(브랜드로 좁힌 굿즈 목록, 독립 팝업 제외).
 * 굿즈 상세·IP 디렉토리·홈·마이 같은 화면은 목록이 아니다.
 */
export function listingStateKeys(pathname: string, search: URLSearchParams): readonly string[] | null {
  if (pathname === '/shop') return LISTING_STATE_KEYS.shop;
  if (pathname === '/shop/new' || pathname === '/shop/best') return LISTING_STATE_KEYS.collection;
  if (pathname === '/search') return search.get('q')?.trim() ? LISTING_STATE_KEYS.search : null;
  if (/^\/ip\/[^/]+$/.test(pathname) && pathname !== AOUAD_POPUP_PATH) return LISTING_STATE_KEYS.ip;
  return null;
}

export function isListingReturnPath(pathname: string, search: URLSearchParams): boolean {
  return listingStateKeys(pathname, search) !== null;
}

/** 목록 화면이면 남길 주소(경로 + 그 화면의 목록 상태 쿼리만), 아니면 null. 나머지 쿼리(결과 플래그·추적 값)는 버린다. */
export function listingReturnEntry(pathname: string, search: URLSearchParams): string | null {
  const keys = listingStateKeys(pathname, search);
  if (!keys) return null;
  const kept = new URLSearchParams();
  search.forEach((value, key) => {
    if (keys.includes(key)) kept.append(key, value);
  });
  const query = kept.toString();
  const entry = query ? `${pathname}?${query}` : pathname;
  return entry.length <= MAX_ENTRY_LENGTH ? entry : null;
}

/** 저장된 값 → 돌아갈 주소. 같은 출처의 굿즈 목록만 받고(목록 상태 키만 다시 거른다) 나머지는 굿즈샵이다. */
export function listingReturnHref(stored: string | null | undefined): string {
  if (!stored || stored.length > MAX_ENTRY_LENGTH || !stored.startsWith('/') || stored.startsWith('//')) {
    return LISTING_RETURN_FALLBACK;
  }
  let url: URL;
  try {
    url = new URL(stored, RESOLVE_BASE);
  } catch {
    return LISTING_RETURN_FALLBACK;
  }
  /* `/\evil.example`·`/\t/evil.example` 같은 값은 해석하면 다른 호스트가 된다 — 출처로 걸러 낸다. */
  if (url.origin !== RESOLVE_BASE) return LISTING_RETURN_FALLBACK;
  return listingReturnEntry(url.pathname, url.searchParams) ?? LISTING_RETURN_FALLBACK;
}

/**
 * 이미 판정한 목록 주소(listingReturnEntry 결과)를 직전 목록으로 남긴다 — 셸은 그 화면이 목록을 실제로 그린 뒤에만 부른다.
 * 저장소가 막혀 있어도 쇼핑은 그대로다(둘러보기는 굿즈샵으로 간다).
 */
export function rememberListingReturnEntry(storage: ListingReturnStorage | null, entry: string): void {
  if (!storage) return;
  try {
    storage.setItem(LISTING_RETURN_STORAGE_KEY, entry);
  } catch {
    /* 사생활 보호 모드·용량 초과 — 남기지 못하면 다음 둘러보기가 굿즈샵으로 간다. */
  }
}

/** 남겨 둔 직전 목록을 다시 판정해 돌려준다. 없거나 읽을 수 없으면 굿즈샵. */
export function readListingReturnHref(storage: ListingReturnStorage | null): string {
  if (!storage) return LISTING_RETURN_FALLBACK;
  try {
    return listingReturnHref(storage.getItem(LISTING_RETURN_STORAGE_KEY));
  } catch {
    return LISTING_RETURN_FALLBACK;
  }
}
