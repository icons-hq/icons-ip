'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  HASH_LANDING_MAX_MOVES,
  HASH_LANDING_QUIET_MS,
  HASH_LANDING_REVEAL_MS,
  HASH_LANDING_WATCH_MS,
  hashLandingLine,
  hashTargetIds,
  isHashLanded,
  shouldLandAfterNavigation,
  shouldLandOnLoad,
  type HashLandingLocation,
} from './hash-landing';

/* 해시 착지 보정 — 판정은 hash-landing.ts 에 있다. 셸 유무와 무관하게(어드민·집중형 화면 포함) 루트 레이아웃에서
   한 번 산다. 브라우저·Next 의 기본 해시 이동을 대신하지 않고, 그 이동이 끝난 뒤에도 대상이 착지선(scroll-padding +
   scroll-margin)에 없을 때만 한 번 더 세운다. 해시 이동을 직접 처리하는 표면(캠페인 목차·어드민 상품 작업대)도 같은
   선에 맞추므로 둘이 겹쳐도 결과가 같다.
   지켜보는 계기는 셋이다: 해시가 붙은 주소로 문서를 열 때, 같은 문서 안 해시 이동(hashchange), 해시를 실은
   클라이언트 이동. 사용자가 휠·터치·키·포인터로 손대면 그 자리에서 그만둔다 — 읽기 시작한 자리를 빼앗지 않는다. */

/** 사용자가 스크롤을 넘겨받았다고 보는 입력. 앱과 브라우저가 옮기는 스크롤은 이 이벤트를 내지 않는다. */
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

function findHashTarget(hash: string): HTMLElement | null {
  for (const id of hashTargetIds(hash)) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

/** 문서가 아닌 스크롤 상자(어드민 상담 화면의 대화·정보 칼럼 등) 안의 대상. 그 상자의 착지는 브라우저 해시 이동에
    맡긴다 — 착지선(html scroll-padding)은 문서 스크롤의 선이라 안쪽 상자에는 맞지 않는다. */
function insideInnerScroller(target: HTMLElement): boolean {
  for (let node = target.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll|overlay)/.test(window.getComputedStyle(node).overflowY)) return true;
  }
  return false;
}

/**
 * 해시 대상을 지켜보다가 착지선에서 벗어나 있으면 다시 세운다. 돌려준 함수로 그만둔다.
 * smoothFirst: 아직 아무도 옮기지 않았을 수 있는 첫 이동(문서를 막 연 경우)은 브라우저 해시 이동처럼 부드럽게 —
 * 데스크톱 헤더가 접히는 만큼은 지금 크롬 높이로 잡은 목표가 이미 품고 있다. 나머지 보정은 즉시 옮긴다.
 */
function watchHashLanding(hash: string, { smoothFirst }: { smoothFirst: boolean }): () => void {
  const startedAt = performance.now();
  let renderedAt: number | null = null;
  let lastScrollAt = startedAt;
  let moves = 0;
  let stopped = false;
  let frame = 0;

  const onScroll = () => {
    lastScrollAt = performance.now();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onScroll);
    for (const type of USER_INPUT_EVENTS) window.removeEventListener(type, stop, true);
  };

  const tick = (now: number) => {
    if (stopped) return;
    if (now - (renderedAt ?? startedAt) > (renderedAt === null ? HASH_LANDING_REVEAL_MS : HASH_LANDING_WATCH_MS)) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(tick);
    const target = findHashTarget(hash);
    /* 스트리밍 경계가 아직 숨긴 대상(hidden 컨테이너 안)은 상자가 없다 — 드러날 때까지 기다린다. */
    if (!target || target.getClientRects().length === 0) return;
    renderedAt ??= now;
    if (now - lastScrollAt < HASH_LANDING_QUIET_MS) return;

    const root = document.documentElement;
    const landed = isHashLanded({
      targetTop: target.getBoundingClientRect().top,
      line: hashLandingLine(window.getComputedStyle(root).scrollPaddingTop, window.getComputedStyle(target).scrollMarginTop),
      scrollY: window.scrollY,
      maxScrollY: root.scrollHeight - window.innerHeight,
    });
    if (landed) return;
    if (moves >= HASH_LANDING_MAX_MOVES || insideInnerScroller(target)) {
      stop();
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'start', behavior: smoothFirst && moves === 0 && !reduceMotion ? 'smooth' : 'instant' });
    moves += 1;
    lastScrollAt = now;
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  for (const type of USER_INPUT_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  frame = window.requestAnimationFrame(tick);
  return stop;
}

export function HashLanding() {
  const pathname = usePathname();
  /* 경로는 그대로 두고 검색어와 해시만 바꾸는 이동(리뷰 정렬 → #reviews, 통계 순위 → #goods-ranking)도 다시 판정한다. */
  const search = useSearchParams().toString();
  const previous = useRef<HashLandingLocation | null>(null);
  const stopWatching = useRef<(() => void) | null>(null);

  useEffect(() => {
    const watch = (hash: string, smoothFirst: boolean) => {
      stopWatching.current?.();
      stopWatching.current = watchHashLanding(hash, { smoothFirst });
    };
    const onHashChange = () => {
      if (previous.current) previous.current = { ...previous.current, hash: window.location.hash };
      if (hashTargetIds(window.location.hash).length) watch(window.location.hash, false);
    };
    window.addEventListener('hashchange', onHashChange);
    /* 지켜보기는 여기서 끊지 않는다 — 스스로 끝나고(시간·사용자 입력), 개발 모드의 effect 재실행이 문서를 막 연
       때의 착지를 지우지 않게 한다. */
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const next = { pathname, hash: window.location.hash };
    const before = previous.current;
    previous.current = next;
    const watch = (smoothFirst: boolean) => {
      stopWatching.current?.();
      stopWatching.current = watchHashLanding(next.hash, { smoothFirst });
    };

    if (before === null) {
      /* 문서를 막 열었다. 복원을 끄고 다시 연 새로고침(리뷰 링크)은 이번 한 번만 해시에 맞추고 복원을 되돌린다 —
         그 기록 항목으로 다시 돌아올 때는 읽던 자리가 복원돼야 한다. */
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const land = hashTargetIds(next.hash).length > 0 && shouldLandOnLoad(navigation?.type, window.history.scrollRestoration);
      if (window.history.scrollRestoration === 'manual') window.history.scrollRestoration = 'auto';
      if (land) watch(true);
      return;
    }
    if (shouldLandAfterNavigation(before, next)) watch(false);
  }, [pathname, search]);

  return null;
}
