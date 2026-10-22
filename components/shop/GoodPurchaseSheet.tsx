'use client';

import { useId, useRef } from 'react';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { Icon } from '@/components/ui/Icon';
import { GoodPurchasePanel, type GoodPurchaseController, type OtherPurchaseAvailability } from './GoodPurchasePanel';

/*
 * 모바일 구매 바텀시트 (PD-01 · 11 §3 Δ2 · §6 B14).
 *
 * 하단 72px 바는 이 시트를 여는 트리거이고, 담기·구매 실행은 시트 안 CTA 가 한다.
 * 시트는 정보 칼럼의 구매 패널을 "통째로" 담는다 — 구매 한도·예약 안내, 직접 입력(필수),
 * 추가 구성, 거래 조건, 합계, CTA, 정기·선물 진입, 상태 문구까지. 필드를 빼면 그 굿즈를
 * 모바일에서 살 수 없게 된다. 같은 컨트롤러를 받으므로 본문 패널과 선택·수량·문구가 같다.
 *
 * 높이는 콘텐츠를 따르고 화면 85%에서 멈춰 안쪽만 스크롤한다. 백드롭·Escape·닫기 버튼으로
 * 닫히고 닫히면 연 버튼으로 포커스가 돌아간다(useOverlayA11y). OverlayPortal 은 호출부에 둔다.
 */
export function GoodPurchaseSheet({ onClose, otherPurchases, purchase }: { onClose: () => void; otherPurchases?: OtherPurchaseAvailability; purchase: GoodPurchaseController }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayA11y({ open: true, onClose, panelRef });

  return (
    <>
      <div aria-hidden="true" className="wc-pdp-sheet__dim" onClick={onClose} />
      <div ref={panelRef} aria-labelledby={titleId} aria-modal="true" className="wc-pdp-sheet" role="dialog">
        <div className="wc-pdp-sheet__head">
          <h2 className="wc-pdp-sheet__title" id={titleId}>{purchase.good.name}</h2>
          <button aria-label="구매 옵션 닫기" className="wc-pdp-sheet__close" onClick={onClose} type="button">
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="wc-pdp-sheet__body">
          <GoodPurchasePanel otherPurchases={otherPurchases} purchase={purchase} />
        </div>
      </div>
    </>
  );
}
