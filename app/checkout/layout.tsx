import type { ReactNode } from 'react';
/* 결제 대기 주문 해소 상자와 바로구매 '다시 구매하기'의 보조 링크(ADR-0030). 장바구니도 같은 파일을 쓴다(app/cart/layout.tsx). */
import '@/app/styles/wc-checkout-pending-release.css';

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return children;
}
