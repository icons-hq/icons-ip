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

/** 표 밖(단위 테스트·다른 화면)에서는 null이다. 부품은 이때 스스로 결과를 보이거나 버튼을 숨긴다. */
export function useShipmentConsoleActions() {
  return useContext(ShipmentConsoleActionsContext);
}
