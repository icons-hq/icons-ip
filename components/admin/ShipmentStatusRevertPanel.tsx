'use client';

import { useState } from 'react';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { ShipmentConsoleNoticeContext, type ShipmentConsoleNotice } from '@/components/admin/screens/ShipmentConsoleContext';
import { ShipmentStatusRevertButton } from './ShipmentStatusRevertButton';
import { SHIPMENT_REVERT_LABELS, type ShipmentRevertKind } from '@/lib/admin/shipment-revert';

export interface ShipmentStatusRevertTarget {
  id: string; reference: string; originName: string; kind: ShipmentRevertKind;
  /** 배송완료 되돌리기는 배송완료 일시, 발송 되돌리기는 대표 운송장. */
  expected: string | null;
  trackingLabel: string | null;
  /** 지금은 되돌릴 수 없는 이유. 주문 상세가 이미 아는 값(예: 배송 안내 메일을 보내는 중)만 넘기고, 있으면 버튼을 잠그고 이유를 보인다. */
  blockedReason?: string | null;
}

/**
 * 줄마다 누르면 일어나는 일. 설명 문단 대신 그 줄의 버튼이 무엇으로 되돌리는지와, 되돌려도 남는 배송 안내 메일을 말한다.
 * 메일 문장은 발송관리의 처리 막대([발송처리])가 말하는 것과 같은 사실이다. 이미 본 앱 알림은 버튼의 확인창이 말한다.
 */
export const SHIPMENT_REVERT_RESULT: Record<ShipmentRevertKind, string> = {
  dispatch: '발송 대기로 되돌립니다. 이미 보낸 배송 안내 메일은 회수되지 않습니다.',
  delivery: '배송중으로 되돌립니다.',
};

/** 줄을 잠그는 이유. 주문 상세가 알려 준 이유가 먼저고, 화면이 직접 아는 것(배송완료 일시를 읽지 못함 — 이 값이 없으면 서버가 되돌리기를 받지 않는다)이 뒤다. */
export function shipmentRevertBlockedReason(target: Pick<ShipmentStatusRevertTarget, 'kind' | 'expected' | 'blockedReason'>): string | null {
  return target.blockedReason || (target.kind === 'delivery' && !target.expected ? '배송완료 일시를 읽지 못했습니다. 새로고침해주세요.' : null);
}

/*
 * 주문 상세의 배송 상태 정정(ADR-0045). 배송 건 줄마다 한 단계 되돌리기 버튼을 두고, 처리 결과는 이 패널이 보존한다 —
 * 되돌린 배송 건의 버튼이 바뀌거나 사라져도(발송 대기) 결과 문구가 남는다. 되돌릴 건도 결과도 없으면 그리지 않는다.
 * 확인창(사유 입력 포함)은 버튼이 띄운다. 이 패널은 줄마다 결과를 보이고, 지금 못 하는 줄은 이유와 함께 잠근다.
 */
export function ShipmentStatusRevertPanel({ targets }: { targets: ShipmentStatusRevertTarget[] }) {
  const [notice, setNotice] = useState<ShipmentConsoleNotice | null>(null);
  if (!targets.length && !notice) return null;
  return <ShipmentConsoleNoticeContext.Provider value={setNotice}>
    <section className="flex flex-col gap-2 border-t pt-4" aria-label="배송 상태 정정" data-shipment-revert-panel="">
      <h3 className="text-sm font-medium text-foreground">배송 상태 정정</h3>
      {notice ? <AdminNotice role={notice.tone === 'danger' ? 'alert' : 'status'} tone={notice.tone}><span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">{notice.message}</span><Button type="button" size="xs" variant="ghost" onClick={() => setNotice(null)}>닫기</Button></span></AdminNotice> : null}
      {targets.length ? <ul className="flex flex-col gap-2">{targets.map(target => { const blocked = shipmentRevertBlockedReason(target); return <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5" key={target.id}>
        <span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere">
          <span><strong className="font-medium">{target.originName} · {target.reference}</strong>
            {/* 배송건번호와 택배사·운송장이 한 덩어리로 읽히지 않게 글자로 나눈다(여백만으로는 붙어 보인다). */}
            {target.trackingLabel ? <span className="text-xs text-muted-foreground tabular-nums">{' · '}{target.trackingLabel}</span> : null}</span>
          <span className="text-xs text-muted-foreground" data-shipment-revert-result={target.kind}>{blocked || SHIPMENT_REVERT_RESULT[target.kind]}</span>
        </span>
        {blocked
          ? <Button type="button" size="xs" variant="outline" disabled aria-label={`배송 건 ${target.reference} ${SHIPMENT_REVERT_LABELS[target.kind]}`}>{SHIPMENT_REVERT_LABELS[target.kind]}</Button>
          : <ShipmentStatusRevertButton shipmentId={target.id} reference={target.reference} kind={target.kind} expected={target.expected} trackingLabel={target.trackingLabel} />}
      </li>; })}</ul> : null}
    </section>
  </ShipmentConsoleNoticeContext.Provider>;
}
