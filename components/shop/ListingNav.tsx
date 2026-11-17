'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/*
 * 목록 화면의 링크 묶음(탭 줄·카테고리 칩) 공용 `<nav>` — 모바일(750 미만)에서 한 줄 가로 스크롤이 되는 자리다.
 * 선택된 링크(`aria-current="page"`)가 가려져 있으면 가로로만 밀어 보이게 한다. `scrollIntoView` 는 쓰지 않는다 —
 * 세로 스크롤까지 건드려 첫 화면이 아래로 끌려 내려간다. 가로로 넘치지 않으면(데스크톱) 아무것도 하지 않는다.
 * `activeKey` 가 바뀔 때만 다시 맞춘다(같은 화면 안 탭 전환 = 라우트 갱신이지 새 마운트가 아니다).
 */
export function ListingNav({ activeKey, children, className, label }: {
  activeKey: string;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const bounds = nav.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    if (target.left < bounds.left) nav.scrollLeft -= bounds.left - target.left + 16;
    else if (target.right > bounds.right) nav.scrollLeft += target.right - bounds.right + 16;
  }, [activeKey]);
  return <nav aria-label={label} className={className} ref={ref}>{children}</nav>;
}
