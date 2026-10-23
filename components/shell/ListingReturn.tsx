'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LISTING_RETURN_FALLBACK,
  readListingReturnHref,
  rememberListingReturn,
  type ListingReturnStorage,
} from '@/lib/listing-return';

/* 직전에 보던 굿즈 목록(lib/listing-return.ts) — 셸이 기록하고 빈 장바구니가 읽는다(CT-02 · 10/14 S17 셋째 기준). */

/* 사생활 보호 모드·차단된 사이트 데이터에서는 접근자부터 던진다 — 그때는 저장소가 없는 것으로 본다. */
function sessionStore(): ListingReturnStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 굿즈 목록 화면을 볼 때마다 그 주소를 탭 세션에 남긴다. useSearchParams 를 쓰므로 셸(Nav)이 Suspense 안에 둔다. */
export function ListingReturnRecorder() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    rememberListingReturn(sessionStore(), pathname, new URLSearchParams(query));
  }, [pathname, query]);
  return null;
}

/* 값은 목록 화면을 떠나 장바구니에 온 뒤에는 바뀌지 않는다 — 구독할 변화가 없다. */
const subscribeToNothing = () => () => {};
const currentHref = () => readListingReturnHref(sessionStore());
const serverHref = () => LISTING_RETURN_FALLBACK;

/** 빈 장바구니 둘러보기 목적지. 서버 렌더·하이드레이션 첫 렌더는 굿즈샵이고, 그 뒤 남겨 둔 직전 목록으로 바뀐다. */
export function useListingReturnHref(): string {
  return useSyncExternalStore(subscribeToNothing, currentHref, serverHref);
}

/** 클릭한 순간의 직전 목록(이벤트 처리기용). */
export function currentListingReturnHref(): string {
  return currentHref();
}
