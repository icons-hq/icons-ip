'use client';

import { Button } from '@/components/admin/kit/ui/button';
import { useShipmentConsoleActions } from './ShipmentConsoleContext';

/** 행의 [배송 방법] — 표가 가진 배송 방법 팝업을 이 배송 건 하나로 연다(S36-072). 표 밖에서는 그리지 않는다. */
export function ShipmentConsoleMethodButton({ shipmentId, reference }: { shipmentId: string; reference: string }) {
  const actions = useShipmentConsoleActions();
  if (!actions) return null;
  return <Button aria-label={`배송 건 ${reference} 배송 방법 변경·인계`} onClick={() => actions.openDelivery([shipmentId], 'method')} size="xs" type="button" variant="outline">
    배송 방법
  </Button>;
}
