import type { ReactNode } from 'react';
/* 주문 내역·주문 상세의 다시 결제 진입(QA1 S-D2-15)이 결제 화면과 같은 '다시 구매하기' 보조 링크를 쓴다(ADR-0030). */
import '@/app/styles/wc-checkout-pending-release.css';

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return children;
}
