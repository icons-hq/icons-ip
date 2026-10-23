/*
 * 직전에 보던 굿즈 목록 — 빈 장바구니의 둘러보기 버튼이 돌아갈 곳(LFS 패리티 2차 L9 CT-02 · 10/14 S17 셋째 기준).
 *
 * 셸(components/shell/ListingReturn.tsx)이 굿즈 목록 화면을 볼 때마다 그 주소를 탭 세션 저장소에 남기고,
 * 빈 장바구니가 그 값을 읽는다. 저장소는 같은 출처의 어떤 스크립트나 사용자도 쓸 수 있는 자리라 읽을 때 다시
 * 판정한다 — 같은 출처의 굿즈 목록 경로만 받고(외부 주소·`//`·역슬래시·목록이 아닌 경로는 거절) 실패하면
 * 굿즈샵(/shop)으로 보낸다. 그래서 이 값으로 열린 리디렉션이 생기지 않는다.
 */
import { AOUAD_POPUP_PATH } from './routes';

export const LISTING_RETURN_STORAGE_KEY = 'icons:listing-return:v1';
export const LISTING_RETURN_FALLBACK = '/shop';

/* 검색어 한두 개가 든 목록 주소는 이 길이를 넘지 않는다 — 넘으면 남기지도 받지도 않는다. */
const MAX_ENTRY_LENGTH = 512;
/* 유입 추적 값은 돌아간 화면에서 다시 집계되면 안 된다(lib/store-analytics 의 icm·utm). */
const TRACKING_PARAM = /^(?:icm|utm_[a-z0-9_]*|gclid|fbclid)$/i;
/* 상대 주소를 판정하려고만 쓰는 가상의 출처다 — 해석 결과가 이 출처를 벗어나면 외부 주소다. */
const RESOLVE_BASE = 'https://listing-return.invalid';

export interface ListingReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 둘러보기가 돌아갈 수 있는 굿즈 목록 화면인가 — 굿즈샵(카테고리·전시 카테고리·필터 포함)·NEW·BEST, 검색 결과(검색어가 있을 때),
 * IP관(브랜드로 좁힌 굿즈 목록, 독립 팝업 제외). 굿즈 상세·IP 디렉토리·홈·마이 같은 화면은 목록이 아니다.
 */
export function isListingReturnPath(pathname: string, search: URLSearchParams): boolean {
  if (pathname === '/shop' || pathname === '/shop/new' || pathname === '/shop/best') return true;
  if (pathname === '/search') return Boolean(search.get('q')?.trim());
  return /^\/ip\/[^/]+$/.test(pathname) && pathname !== AOUAD_POPUP_PATH;
}

/** 목록 화면이면 남길 주소(경로 + 추적 값을 뺀 쿼리), 아니면 null. */
export function listingReturnEntry(pathname: string, search: URLSearchParams): string | null {
  if (!isListingReturnPath(pathname, search)) return null;
  const kept = new URLSearchParams();
  search.forEach((value, key) => {
    if (!TRACKING_PARAM.test(key)) kept.append(key, value);
  });
  const query = kept.toString();
  const entry = query ? `${pathname}?${query}` : pathname;
  return entry.length <= MAX_ENTRY_LENGTH ? entry : null;
}

/** 저장된 값 → 돌아갈 주소. 같은 출처의 굿즈 목록만 받고 나머지는 굿즈샵이다. */
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

/** 지금 화면이 굿즈 목록이면 직전 목록으로 남긴다. 저장소가 막혀 있어도 쇼핑은 그대로다(둘러보기는 굿즈샵으로 간다). */
export function rememberListingReturn(storage: ListingReturnStorage | null, pathname: string, search: URLSearchParams): void {
  const entry = listingReturnEntry(pathname, search);
  if (!entry || !storage) return;
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
