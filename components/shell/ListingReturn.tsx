'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LISTING_RETURN_FALLBACK,
  listingReturnEntry,
  listingReturnLabel,
  readListingReturnHref,
  rememberListingReturnEntry,
  type ListingReturnStorage,
} from '@/lib/listing-return';

/* 직전에 보던 굿즈 목록(lib/listing-return.ts) — 셸이 기록하고 빈 상태의 둘러보기 버튼이 읽는다(CT-02 · 10/14 S17 셋째 기준). */

/* 사생활 보호 모드·차단된 사이트 데이터에서는 접근자부터 던진다 — 그때는 저장소가 없는 것으로 본다. */
function sessionStore(): ListingReturnStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/*
 * 라우트 경계가 그린 표면. 목록 주소라도 화면이 목록을 그렸다는 뜻은 아니다 — 없는·보관된 IP관은 notFound() 를 부르고
 * Next 의 soft 404 는 200 이라 주소와 응답만으로는 모른다. 루트 경계는 #root 안에 표식을 남긴다: 로딩(app/loading.tsx)은
 * .wc-loading, 찾을 수 없음(app/not-found.tsx)·오류(app/error.tsx)는 .wc-fallback(ListingReturn.client.test 가 세 파일을 대조).
 * 스트리밍으로 늦게 오는 본문은 #root 밖 숨은 상자에 있다가 옮겨지므로 #root 안만 본다.
 */
const ROUTE_PENDING_SELECTOR = '.wc-loading';
const ROUTE_FALLBACK_SELECTOR = '.wc-fallback';

export type RouteSurface = 'pending' | 'fallback' | 'rendered';

export function routeSurface(root: Pick<ParentNode, 'querySelector'>): RouteSurface {
  if (root.querySelector(ROUTE_FALLBACK_SELECTOR)) return 'fallback';
  if (root.querySelector(ROUTE_PENDING_SELECTOR)) return 'pending';
  return 'rendered';
}

/**
 * 지금 라우트가 화면을 실제로 그리면(로딩 경계가 걷히고 찾을 수 없음·오류 표면이 아니면) 한 번 부른다. 아직이면 #root 의
 * 변화를 지켜보다가 그때 부른다 — 오류 화면에서 [다시 시도]로 목록이 그려져도 그때 남는다. 돌려준 함수로 그만둔다(라우트가 바뀌면 셸이 부른다).
 */
function whenRouteRendered(onRendered: () => void): () => void {
  const root = document.getElementById('root');
  if (!root) return () => {};
  if (routeSurface(root) === 'rendered') {
    onRendered();
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (routeSurface(root) !== 'rendered') return;
    observer.disconnect();
    onRendered();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * 굿즈 목록 화면을 그릴 때마다 그 주소(목록 상태만)를 탭 세션에 남긴다. 찾을 수 없음·오류 화면은 직전 목록을 덮지 않는다.
 * useSearchParams 를 쓰므로 셸(Nav)이 Suspense 안에 둔다.
 */
export function ListingReturnRecorder() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const entry = listingReturnEntry(pathname, new URLSearchParams(query));
    if (!entry) return undefined;
    return whenRouteRendered(() => rememberListingReturnEntry(sessionStore(), entry));
  }, [pathname, query]);
  return null;
}

/* 값은 목록 화면을 떠나 장바구니에 온 뒤에는 바뀌지 않는다 — 구독할 변화가 없다. */
const subscribeToNothing = () => () => {};
const currentHref = () => readListingReturnHref(sessionStore());
const serverHref = () => LISTING_RETURN_FALLBACK;

/** 둘러보기 목적지. 서버 렌더·하이드레이션 첫 렌더는 굿즈샵이고, 그 뒤 남겨 둔 직전 목록으로 바뀐다. */
export function useListingReturnHref(): string {
  return useSyncExternalStore(subscribeToNothing, currentHref, serverHref);
}

/** 클릭한 순간의 직전 목록(이벤트 처리기용). */
export function currentListingReturnHref(): string {
  return currentHref();
}

/**
 * 빈 상태의 둘러보기 링크 — 직전에 보던 굿즈 목록(없으면 굿즈샵)으로 가고, 문구는 그 목적지를 말한다(listingReturnLabel).
 * 서버 화면(주문 목록)에서도 이 부품만 클라이언트로 그린다. children 은 표면을 말하지 않는 문구('굿즈 다시 담기')일 때만 넘긴다.
 */
export function ListingReturnLink({ children, className }: { children?: ReactNode; className?: string }) {
  const href = useListingReturnHref();
  return <Link className={className} href={href}>{children ?? listingReturnLabel(href)}</Link>;
}
