'use client';

import { useEffect, useRef, type RefObject } from 'react';

/* 검색 패널과 전체 메뉴 시트가 공유하는 오버레이 접근성 — 배경 스크롤 잠금, 배경 inert,
   최초 포커스, Escape 닫기, Tab 순환, 닫힐 때 이전 포커스 복귀.
   구 Nav.tsx의 전체 메뉴 effect를 두 오버레이가 함께 쓰도록 훅으로 뽑아낸 것이다. */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useOverlayA11y({
  open,
  onClose,
  panelRef,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
}): void {
  /* onClose는 부모가 렌더마다 새로 만드는 화살표 함수다. 그대로 의존성에 넣으면
     스크롤 축약 같은 무관한 리렌더마다 effect가 재실행돼 포커스를 다시 뺏는다. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /* 본문과 푸터를 inert로 덮어 오버레이 밖으로 탭이 새지 않게 한다. */
    const backgroundElements = [
      document.getElementById('root'),
      document.querySelector<HTMLElement>('.wc-footer'),
    ].filter((element): element is HTMLElement => Boolean(element));
    const previousInert = backgroundElements.map((element) => element.inert);
    document.body.style.overflow = 'hidden';
    backgroundElements.forEach((element) => {
      element.inert = true;
    });

    const getFocusable = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    /* initialFocusRef가 없으면 패널 안 첫 포커서블(= 닫기 버튼)로 들어간다. */
    (initialFocusRef?.current ?? getFocusable()[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      backgroundElements.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      previousFocus?.focus();
    };
  }, [initialFocusRef, open, panelRef]);
}
