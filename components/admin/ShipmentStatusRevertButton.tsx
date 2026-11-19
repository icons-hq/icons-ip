'use client';

import { useContext, useRef, useState, useTransition } from 'react';
import { revertShipmentDeliveryAction, revertShipmentDispatchAction } from '@/app/admin/shipment-revert-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { ShipmentConsoleNoticeContext, type ShipmentConsoleNotice } from '@/components/admin/screens/ShipmentConsoleContext';
import { adminPrompt } from '@/lib/admin/confirm';
import { SHIPMENT_REVERT_LABELS, SHIPMENT_REVERT_REASON_MAX, SHIPMENT_REVERT_REASON_MIN, shipmentRevertPrompt, type ShipmentRevertKind } from '@/lib/admin/shipment-revert';

/*
 * 배송 건 행의 '배송완료 되돌리기'·'발송 되돌리기'(원장 #14 SHP-048, ADR-0045). 판매 관리 권한 운영자에게만 그린다.
 * 확인창(kit AlertDialog)에서 되돌리는 결과·회수할 수 없는 고객 안내를 읽고 사유(5~500자)를 적어야 실행한다.
 * 같은 내용으로 다시 누르면 같은 작업 번호를 보내 한 번만 반영된다. 결과는 표(또는 주문 상세 패널)가 보존하고, 그 밖에서는 버튼 아래에 둔다.
 * 목록·주문 상세는 서버 액션의 revalidatePath가 새로 그린다(옆 패널들과 같다).
 */
export function ShipmentStatusRevertButton({ shipmentId, reference, kind, expected, packCount, trackingLabel }: {
  shipmentId: string;
  /** 화면에 보이는 배송건번호(확인창·결과 문구·접근성 이름). */
  reference: string;
  kind: ShipmentRevertKind;
  /** 화면이 본 값 — 배송완료 되돌리기는 배송완료 일시, 발송 되돌리기는 대표 운송장. 그 사이 바뀌었으면 DB가 거절한다. */
  expected: string | null;
  packCount?: number | null;
  /** 발송 되돌리기 확인창에 적을 '택배사 운송장'. */
  trackingLabel?: string | null;
}) {
  const report = useContext(ShipmentConsoleNoticeContext);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<ShipmentConsoleNotice | null>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const label = SHIPMENT_REVERT_LABELS[kind];
  function show(next: ShipmentConsoleNotice) { if (report) report(next); else setNotice(next); }
  async function start() {
    if (pending) return;
    if (kind === 'delivery' && !expected) { show({ tone: 'danger', message: '배송완료 일시를 읽지 못했습니다. 새로고침해주세요.' }); return; }
    const reason = await adminPrompt({
      ...shipmentRevertPrompt(kind, { reference, packCount, trackingLabel }), destructive: true, cancelLabel: '닫기',
      input: { label: '되돌리는 사유 (감사 기록에 남습니다)', placeholder: kind === 'delivery' ? '예: 다른 주문의 배송 건을 배송완료로 눌렀음' : '예: 다른 주문의 운송장을 이 배송 건에 등록했음',
        minLength: SHIPMENT_REVERT_REASON_MIN, maxLength: SHIPMENT_REVERT_REASON_MAX },
    });
    if (reason === null) return;
    const key = `${kind}:${shipmentId}:${expected ?? ''}:${reason}`;
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    const operationId = operation.current.id;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = kind === 'delivery'
          ? await revertShipmentDeliveryAction({ shipmentId, reason, operationId, expectedDeliveredAt: expected, reference })
          : await revertShipmentDispatchAction({ shipmentId, reason, operationId, expectedTrackingNumber: expected, reference });
        if (result.ok) { operation.current = null; show({ tone: result.tone, message: result.message }); }
        else show({ tone: 'danger', message: result.error });
      } catch {
        show({ tone: 'danger', message: '되돌리기 결과를 확인하지 못했습니다. 같은 사유로 다시 누르면 한 번만 반영됩니다. 새로고침해 상태를 확인해주세요.' });
      }
    });
  }
  return <span className="flex flex-col items-start gap-1" data-shipment-revert={kind}>
    <Button type="button" size="xs" variant="outline" disabled={pending} aria-label={`배송 건 ${reference} ${label}`} onClick={start}>{pending ? '되돌리는 중…' : label}</Button>
    {notice ? <AdminNotice role={notice.tone === 'danger' ? 'alert' : 'status'} tone={notice.tone}>{notice.message}</AdminNotice> : null}
  </span>;
}
