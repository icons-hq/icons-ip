'use client';

import { createContext, useContext, useEffect, useId } from 'react';

/*
 * 목록 위 클레임 팝업(R8)의 대기(busy) 신호. 팝업 안 처리 패널이 서버 액션을 기다리는 동안 팝업을
 * 닫지 못하게 알린다. 고객 주문 화면과 같이 쓰는 패널(요청 철회·클레임 비용)도 부르므로 어드민
 * 팝업 모듈 밖의 중립 모듈에 둔다 — 고객 번들이 어드민 대화상자 코드를 끌어오지 않게 한다.
 */
export type ClaimPreviewBusyReport = (source: string, busy: boolean) => void;
/** 팝업(ClaimPreviewDialog)이 값을 제공한다. 팝업 밖에서는 null·false다. */
export const ClaimPreviewBusyReporter = createContext<ClaimPreviewBusyReport | null>(null);
export const ClaimPreviewBusy = createContext(false);

/**
 * 팝업 안 처리 패널이 서버 액션을 기다리는 동안(busy) 팝업을 닫지 못하게 알린다. 팝업 밖(독립
 * 상세 라우트·고객 주문 화면)에서는 아무 일도 하지 않는다.
 */
export function useClaimPreviewBusy(busy: boolean) {
  const report = useContext(ClaimPreviewBusyReporter);
  const source = useId();
  useEffect(() => {
    if (!report || !busy) return;
    report(source, true);
    return () => report(source, false);
  }, [busy, report, source]);
}
