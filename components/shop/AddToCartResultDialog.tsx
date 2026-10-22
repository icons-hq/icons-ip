'use client';

import Link from 'next/link';
import { useId, useRef } from 'react';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';

/** 담기 결과 모달에 요약해 보일 한 줄. 옵션 이름은 기본 옵션처럼 보일 이름이 없으면 비운다. */
export interface AddToCartResultItem {
  name: string;
  option?: string | null;
  quantity: number;
}

export interface AddToCartResultDialogProps {
  open: boolean;
  onClose: () => void;
  items: readonly AddToCartResultItem[];
  title?: string;
  continueLabel?: string;
  cartHref?: string;
  cartLabel?: string;
}

/*
 * 담기 결과 모달 (11 §6 B10 · PD-02, L6 위시 담기도 재사용한다).
 *
 * 여는 시점은 호출부가 정한다 — 카트 반영이 확정(서버 저장 또는 게스트 카트 저장)된
 * 뒤에만 연다. 실패면 열지 않는다(DESIGN §9 "서버 확인 전 완료 금지").
 * 계속 쇼핑 = 닫고 현재 화면 유지, 장바구니 보기 = /cart 이동. 헤더 카트 수량은
 * CartProvider 가 같은 반영으로 이미 갱신한다.
 *
 * #root 밖으로 내보내는 OverlayPortal 은 호출부에 둔다 — renderToStaticMarkup 테스트가
 * 이 컴포넌트를 직접 렌더할 수 있게 하기 위해서다. 래퍼가 딤이라 바깥 클릭은 닫기다.
 */
export function AddToCartResultDialog({
  cartHref = '/cart',
  cartLabel = '장바구니 보기',
  continueLabel = '계속 쇼핑',
  items,
  onClose,
  open,
  title = '장바구니에 담았어요',
}: AddToCartResultDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /* 첫 포커스는 패널 안 첫 버튼(계속 쇼핑)이다 — 실수로 Enter 를 눌러도 화면을 떠나지 않는다. */
  useOverlayA11y({ open, onClose, panelRef });

  if (!open) return null;

  return (
    <div className="wc-cart-result" onClick={onClose}>
      <div
        ref={panelRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="wc-cart-result__panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="wc-cart-result__title" id={titleId}>{title}</h2>
        {items.length ? (
          <ul className="wc-cart-result__items">
            {items.map((item, index) => (
              <li key={`${index}-${item.name}`}>
                <strong>{item.name}</strong>
                <span>{[item.option, `수량 ${item.quantity.toLocaleString('ko-KR')}개`].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="wc-btn-group wc-cart-result__actions">
          <button className="wc-btn" onClick={onClose} type="button">{continueLabel}</button>
          {/* 이동하는 동안 모달을 남겨 둔다 — 먼저 닫으면 카트가 그려지기 전까지 상세가 잠깐 다시 보인다. */}
          <Link className="wc-btn primary" href={cartHref}>{cartLabel}</Link>
        </div>
      </div>
    </div>
  );
}
