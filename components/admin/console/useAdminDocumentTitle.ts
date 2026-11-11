'use client';

import { useEffect } from 'react';

/** 미답변 문의 수 접두사 `(3) `는 알림 쪽이 붙이고 뗀다. 이 훅은 그 뒤의 제목만 본다. */
const INQUIRY_COUNT_PREFIX = /^\(\d+\+?\) /;

export function adminDocumentTitle(title: string): string {
  return `${title} · ICONS 판매자센터`;
}

/** 지금 탭 제목을 바꿔야 하면 바꿀 값을, 이미 맞으면 null을 돌려준다. */
export function nextAdminDocumentTitle(current: string, title: string): string | null {
  const desired = adminDocumentTitle(title);
  return current.replace(INQUIRY_COUNT_PREFIX, '') === desired ? null : desired;
}

/**
 * 탭 제목을 화면 제목으로 유지한다. Next의 서버 메타데이터가 응답마다 `<title>`을 새로 넣기 때문에
 * (`?tab=` 이동·`router.refresh()`·서버 액션 뒤) 한 번 쓰는 것으로는 `ICONS`로 돌아간다.
 * 문의 수 접두사가 붙은 제목은 이미 맞는 제목으로 본다 — 알림과 서로 덮어쓰지 않는다.
 */
export function useAdminDocumentTitle(title: string): void {
  useEffect(() => {
    const apply = () => {
      const next = nextAdminDocumentTitle(document.title, title);
      if (next !== null) document.title = next;
    };
    apply();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
