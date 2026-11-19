'use client';

import { createContext, useContext } from 'react';

/*
 * 배송 건 표(ShipmentConsoleGrid)가 행 안의 부품에게 주는 통로. 행 셀은 서버 화면(ShipmentConsoleScreen)이
 * 만들지만 렌더는 표 안에서 일어나므로, 행의 운송장 칸·배송 방법 버튼이 처리 결과를 표 위 알림에 올리고
 * 표가 가진 배송 방법 팝업을 연다. 처리한 행은 목록에서 빠지므로 결과 문구는 행이 아니라 표가 보존한다.
 */
export type ShipmentConsoleNotice = { tone: 'success' | 'warning' | 'danger'; message: string };
export type ShipmentDeliveryDialogMode = 'method' | 'dispatch';
export interface ShipmentConsoleActions {
  report: (notice: ShipmentConsoleNotice) => void;
  openDelivery: (shipmentIds: string[], mode: ShipmentDeliveryDialogMode) => void;
}

export const ShipmentConsoleActionsContext = createContext<ShipmentConsoleActions | null>(null);

/**
 * 행 부품이 처리 결과를 표 위 알림에 올리는 통로만. 배송현황처럼 행 처리 팝업이 없는 표에서도 준다 —
 * 배송 상태 되돌리기(ADR-0045)는 처리한 행이 다른 탭으로 옮겨 가므로 결과 문구를 표(또는 주문 상세의 패널)가 보존한다.
 */
export const ShipmentConsoleNoticeContext = createContext<((notice: ShipmentConsoleNotice) => void) | null>(null);

/** 표 밖(단위 테스트·다른 화면)에서는 null이다. 부품은 이때 스스로 결과를 보이거나 버튼을 숨긴다. */
export function useShipmentConsoleActions() {
  return useContext(ShipmentConsoleActionsContext);
}
