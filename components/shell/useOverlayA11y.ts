'use client';

import { useEffect, useRef, type RefObject } from 'react';

/* 모달 오버레이가 공유하는 접근성 — 배경 스크롤 잠금, 배경 inert, 최초 포커스,
   Escape 닫기, Tab 순환, 닫힐 때 이전 포커스 복귀.
   구 Nav.tsx의 전체 메뉴 effect를 뽑아낸 것으로, 셸 오버레이(검색·전체 메뉴)와
   화면 오버레이(Shop 필터 시트, Binder 카드 상세)가 함께 쓴다.
   패널은 inert 대상(#root·셸 행들) 밖에 있어야 한다 — #root 안 화면의 오버레이는
   OverlayPortal로 body 직계에 렌더한다. */

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
    /* 다이얼로그 밖 상호작용 표면 전부를 inert로 덮는다 — 본문·푸터만 덮으면
       유틸바·헤더 컨트롤·탭바가 접근성 트리에 남아 모달인데 밖을 조작할 수 있게 된다.
       검색 패널은 .wc-header "안"에 있으므로 헤더 전체가 아니라 형제 행들만 개별로 덮는다.
       패널이 후보 안에 있으면 그 후보는 건너뛴다 — #root 안 화면 오버레이가 자기 자신까지
       inert로 얼려 페이지가 잠기는 사고 방지. 이 안전망은 배경 일부(그 후보의 내용)를 덮지
       못하므로, #root 안 화면의 오버레이는 OverlayPortal로 밖에 두는 것이 정상 경로다. */
    const panel = panelRef.current;
    const backgroundElements = [
      document.getElementById('root'),
      ...document.querySelectorAll<HTMLElement>(
        '.wc-footer, .wc-utilbar, .wc-header__bar, .wc-gnb-wrap, .wc-tabbar',
      ),
    ].filter((element): element is HTMLElement => element !== null && !element.contains(panel));
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
