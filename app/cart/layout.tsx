import type { ReactNode } from 'react';
/* 장바구니 선택 주문·선택 삭제(ADR-0030)의 행 체크 칸과 선택 바. 카트 절의 나머지 규칙은 wc-catalog.css 가 소유한다. */
import '@/app/styles/wc-cart-selection.css';

export default function CartLayout({ children }: { children: ReactNode }) {
  return children;
}
