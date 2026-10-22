'use client';

import { useRouter } from 'next/navigation';
import { WcButton } from '@/components/wc/WcButton';

/** '이전 페이지'가 실제로 돌아갈 곳이 있는가. 새 탭·주소 직접 입력으로 404에 왔다면 이 탭의 기록이 1개라
 *  뒤로 가기가 아무 일도 하지 않으므로 홈으로 보낸다. */
export function previousPageTarget(historyLength: number): 'back' | 'home' {
  return historyLength > 1 ? 'back' : 'home';
}

/* 404 2CTA(CH-14) — [이전 페이지](잉크) / [메인으로](아웃라인). 크기(260×56)는 wc-chrome.css의 404 구간이 정한다.
   not-found는 서버 컴포넌트로 두고 기록을 읽는 이 버튼 묶음만 클라이언트로 뺀다. */
export function NotFoundActions() {
  const router = useRouter();

  const goBack = () => {
    if (previousPageTarget(window.history.length) === 'back') router.back();
    else router.push('/');
  };

  return (
    <div className="wc-btn-group wc-not-found__actions">
      <WcButton onClick={goBack} variant="primary">이전 페이지</WcButton>
      <WcButton href="/">메인으로</WcButton>
    </div>
  );
}
