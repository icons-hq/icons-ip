'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 상단 이 구간 안에서는 항상 헤더를 보여준다. */
const REVEAL_ZONE = 80;
/** 방향 전환으로 인정할 최소 이동량. 손떨림 수준의 스크롤에 헤더가 깜빡이지 않게 한다. */
const DELTA_THRESHOLD = 12;

export function shouldHideEditorialHeader({
  currentY,
  previousY,
  hidden,
}: {
  currentY: number;
  previousY: number;
  hidden: boolean;
}) {
  if (currentY <= REVEAL_ZONE) return false;
  const delta = currentY - previousY;
  if (delta >= DELTA_THRESHOLD) return true;
  if (delta <= -DELTA_THRESHOLD) return false;
  return hidden;
}

/**
 * 스크롤 방향에 따른 헤더 숨김을 홈 헤더와 에디토리얼 헤더가 공유한다.
 * `resetKey`가 바뀌면(라우트 전환) 이전 화면의 숨김 상태와 스크롤 기준점을 버린다.
 * 숨김 상태는 `<html data-header-hidden>`으로도 노출해 sticky 서브바가 헤더 위치를 따라갈 수 있게 한다.
 */
export function useHeaderScrollHide({
  forceVisible = false,
  resetKey,
}: { forceVisible?: boolean; resetKey?: string } = {}) {
  const [hidden, setHidden] = useState(false);
  const [trackedKey, setTrackedKey] = useState(resetKey);
  const anchorRef = useRef(0);
  const reveal = useCallback(() => setHidden(false), []);

  // 라우트가 바뀌면 렌더 중에 숨김 상태를 되돌린다. 스크롤 기준점은 아래 effect가 다시 잡는다.
  if (trackedKey !== resetKey) {
    setTrackedKey(resetKey);
    setHidden(false);
  }

  useEffect(() => {
    if (forceVisible) return;

    const onScroll = () => {
      const currentY = window.scrollY;
      const previousY = anchorRef.current;
      if (currentY <= REVEAL_ZONE || Math.abs(currentY - previousY) >= DELTA_THRESHOLD) {
        anchorRef.current = currentY;
      }
      setHidden((current) => shouldHideEditorialHeader({ currentY, previousY, hidden: current }));
    };

    anchorRef.current = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [forceVisible, resetKey]);

  const effectiveHidden = forceVisible ? false : hidden;

  useEffect(() => {
    document.documentElement.dataset.headerHidden = effectiveHidden ? 'true' : 'false';
    return () => {
      delete document.documentElement.dataset.headerHidden;
    };
  }, [effectiveHidden]);

  return { hidden: effectiveHidden, reveal };
}
