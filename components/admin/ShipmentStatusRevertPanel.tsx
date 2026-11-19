'use client';

import { useState } from 'react';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { ShipmentConsoleNoticeContext, type ShipmentConsoleNotice } from '@/components/admin/screens/ShipmentConsoleContext';
import { ShipmentStatusRevertButton } from './ShipmentStatusRevertButton';
import type { ShipmentRevertKind } from '@/lib/admin/shipment-revert';

export interface ShipmentStatusRevertTarget {
  id: string; reference: string; originName: string; kind: ShipmentRevertKind;
  /** 배송완료 되돌리기는 배송완료 일시, 발송 되돌리기는 대표 운송장. */
  expected: string | null;
  trackingLabel: string | null;
}

/*
 * 주문 상세의 배송 상태 정정(ADR-0045). 배송 건 행마다 한 단계 되돌리기 버튼을 두고, 처리 결과는 이 패널이 보존한다 —
 * 되돌린 배송 건의 버튼이 바뀌거나 사라져도(발송 대기) 결과 문구가 남는다. 되돌릴 건도 결과도 없으면 그리지 않는다.
 */
export function ShipmentStatusRevertPanel({ targets }: { targets: ShipmentStatusRevertTarget[] }) {
  const [notice, setNotice] = useState<ShipmentConsoleNotice | null>(null);
  if (!targets.length && !notice) return null;
  return <ShipmentConsoleNoticeContext.Provider value={setNotice}>
    <section className="flex flex-col gap-2 border-t pt-4" aria-label="배송 상태 정정" data-shipment-revert-panel="">
      <h3 className="text-sm font-medium text-foreground">배송 상태 정정</h3>
      <p className="text-sm text-muted-foreground">엉뚱한 배송 건을 발송·배송완료로 처리했을 때 한 단계 되돌립니다. 구매확정·리뷰·취소·반품·교환이 있는 주문은 되돌리지 않습니다.</p>
      {notice ? <AdminNotice role={notice.tone === 'danger' ? 'alert' : 'status'} tone={notice.tone}><span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">{notice.message}</span><Button type="button" size="xs" variant="ghost" onClick={() => setNotice(null)}>닫기</Button></span></AdminNotice> : null}
      {targets.length ? <ul className="flex flex-col gap-2">{targets.map(target => <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5" key={target.id}>
        <span className="min-w-0 wrap-anywhere"><strong className="font-medium">{target.originName} · {target.reference}</strong>
          {target.trackingLabel ? <span className="ml-2 text-xs text-muted-foreground tabular-nums">{target.trackingLabel}</span> : null}</span>
        <ShipmentStatusRevertButton shipmentId={target.id} reference={target.reference} kind={target.kind} expected={target.expected} trackingLabel={target.trackingLabel} />
      </li>)}</ul> : null}
    </section>
  </ShipmentConsoleNoticeContext.Provider>;
}
