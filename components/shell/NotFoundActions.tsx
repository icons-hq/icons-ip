'use client';

import { useRouter } from 'next/navigation';
import { goBackFromCart, type CartBackEnv, type ProbeWindow } from '@/components/cart/cart-back';
import { WcButton } from '@/components/wc/WcButton';

/** '이전 페이지' — 앞에 돌아갈 ICONS 화면이 있을 때만 뒤로 가고, 아니면 홈으로 보낸다.
 *  history.length 만 보면 탭의 첫 기록인 404(앞으로 가기 기록이 있거나 빈 탭·다른 사이트에서 연 경우)에서 뒤로 가기가
 *  아무 일도 하지 않거나 ICONS 를 떠난다. 판정은 카트 서브헤더와 같다(cart-back.ts — Navigation API canGoBack, 없으면 뒤로 가 보고
 *  아무 이동이 없을 때 대체 경로). 대체 경로는 직전 목록이 아니라 홈이다. */
export function goBackFromNotFound(win: CartBackEnv & ProbeWindow, router: { back(): void; push(href: string): void }): void {
  goBackFromCart(win, () => router.back(), () => router.push('/'));
}

/* 404 2CTA(CH-14) — [이전 페이지](잉크) / [메인으로](아웃라인). 크기(260×56)는 wc-chrome.css의 404 구간이 정한다.
   not-found는 서버 컴포넌트로 두고 기록을 읽는 이 버튼 묶음만 클라이언트로 뺀다. */
export function NotFoundActions() {
  const router = useRouter();

  return (
    <div className="wc-btn-group wc-not-found__actions">
      <WcButton onClick={() => goBackFromNotFound(window as unknown as CartBackEnv & ProbeWindow, router)} variant="primary">이전 페이지</WcButton>
      <WcButton href="/">메인으로</WcButton>
    </div>
  );
}
