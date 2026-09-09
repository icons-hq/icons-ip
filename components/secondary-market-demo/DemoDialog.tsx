'use client';

import { useRef, type ReactNode } from 'react';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';

/* 시연 다이얼로그 셸 — Binder 카드 상세와 같은 계약이다. 래퍼가 딤이라 바깥 클릭은 닫기,
 * 패널 클릭은 전파를 끊는다. 포커스 트랩·Escape·복귀 포커스·배경 inert 는 useOverlayA11y 몫이고,
 * #root 밖으로 내보내는 OverlayPortal 은 호출부(화면)에 있다 — renderToStaticMarkup 테스트가
 * 이 컴포넌트를 직접 렌더할 수 있게 하기 위해서다. 조건부 마운트라 open 은 상수 true 다. */
export function DemoDialog({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayA11y({ open: true, onClose, panelRef });

  return (
    <div className="wc-c2c__dialog" onClick={onClose}>
      <div
        ref={panelRef}
        aria-label={title}
        aria-modal="true"
        className="wc-c2c__dialog-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="wc-c2c__dialog-head">
          <h2 className="wc-c2c__dialog-title">{title}</h2>
          <button className="wc-c2c__dialog-close" onClick={onClose} type="button">닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}
