'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { fetchSecondaryMarketDemoVisible } from '@/lib/secondary-market-demo.client';
import { useAuthPresence, type AuthPresence } from './AuthPresenceProvider';

/* 세컨더리 마켓 시연 진입점 가시성 — 푸터가 읽는다. 로그인 presence 가 확정된 뒤에만
 * is_staff readback 을 보내고, 로그아웃되면 값이 저절로 닫힌다.
 * readback 은 경로가 바뀔 때마다 다시 보낸다(AuthPresenceProvider 가 pathname 마다
 * 재구독하는 것과 같은 리듬) — 세션이 살아 있는 채로 강등·정지된 스태프에게 새로고침
 * 전까지 진입점이 남지 않게 하기 위해서다. 라우트 서버 게이트는 이와 무관하게 매 요청
 * 판정한다. presence 가 바뀔 때의 초기화는 effect 안 동기 setState 대신 렌더 중 "이전
 * 값과 다르면 되돌리기" 패턴으로 한다 — 같은 브라우저에서 스태프가 나가고 일반 회원이
 * 들어와도 이전 결과가 새 세션에 잠깐이라도 새지 않는다. 기본값은 항상 false 라
 * provider 밖(테스트·정적 렌더)에서도 진입점은 닫혀 있다. */
const SecondaryMarketDemoContext = createContext(false);

export function SecondaryMarketDemoAvailabilityProvider({ children }: { children: ReactNode }) {
  const presence = useAuthPresence();
  const pathname = usePathname();
  const [trackedPresence, setTrackedPresence] = useState<AuthPresence>(presence);
  const [visible, setVisible] = useState(false);

  if (trackedPresence !== presence) {
    setTrackedPresence(presence);
    setVisible(false);
  }

  useEffect(() => {
    if (presence !== 'signed-in') return;
    let active = true;
    void fetchSecondaryMarketDemoVisible().then((next) => {
      if (active) setVisible(next);
    });
    return () => {
      active = false;
    };
  }, [pathname, presence]);

  return (
    <SecondaryMarketDemoContext.Provider value={presence === 'signed-in' && visible}>
      {children}
    </SecondaryMarketDemoContext.Provider>
  );
}

export function useSecondaryMarketDemoVisible() {
  return useContext(SecondaryMarketDemoContext);
}
