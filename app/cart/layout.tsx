import type { ReactNode } from 'react';
/* 장바구니 선택 주문·선택 삭제(ADR-0030)의 행 체크 칸과 선택 바. 카트 절의 나머지 규칙은 wc-catalog.css 가 소유한다. */
import '@/app/styles/wc-cart-selection.css';
/* 결제 대기 주문 해소 상자(ADR-0030) — 주문서와 같은 파일이다(app/checkout/layout.tsx). */
import '@/app/styles/wc-checkout-pending-release.css';

export default function CartLayout({ children }: { children: ReactNode }) {
  return children;
}
