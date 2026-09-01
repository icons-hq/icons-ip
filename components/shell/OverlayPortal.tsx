'use client';

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/* #root 안 화면이 띄우는 오버레이(바텀시트·다이얼로그)를 body 직계로 옮기는 포털.
   #root 안에 그대로 두면 두 가지가 동시에 깨진다:
   - useOverlayA11y가 #root를 inert로 덮으므로 오버레이 자신까지 비활성화된다(모바일은
     Escape도 없어 페이지 전체가 잠긴다).
   - #root는 z-index: 2 스태킹 컨텍스트라(globals.css) 안쪽 z-index가 아무리 커도 body
     레벨에선 2로 캡핑돼, 셸 헤더·탭바(z-index: 3)가 딤 위에 뜬다(DESIGN §"z-index"의
     overlay 999+ 계약 위반).
   포털로 나가면 셸 오버레이(MenuSheet 등)와 같은 조건이 된다. --wc-* 토큰은 .wc-root
   스코프에만 있으므로(wc-foundation.css) 래퍼로 다시 감싼다 — 자식이 전부 fixed라
   래퍼 자체는 높이 0으로 보이지 않는다.
   열린 뒤에만 마운트되는 오버레이가 전제다. 서버 렌더에서는 붙일 body가 없으므로
   그리지 않는다 — renderToStaticMarkup 테스트는 포털 안쪽 컴포넌트를 직접 렌더하라. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-root">{children}</div>, document.body);
}
