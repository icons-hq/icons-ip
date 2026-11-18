'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { swapShipmentTrackingAction } from '@/app/admin/shipment-tracking-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import { SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';

/*
 * 뒤바뀐 운송장 맞바꾸기(SHP-031). 창고가 두 주문의 운송장을 서로 바꿔 회신해 그대로 등록됐으면, 운송장 정정은 상대 번호가 다른 주문에
 * 쓰였다며 거절한다. 상대 배송건번호와 그 배송 건에 지금 등록된 번호(= 이 배송 건의 실제 번호)를 적으면 두 대표 운송장을 한 번에
 * 맞바꾼다. 화면이 본 번호가 지금 값과 같을 때만 바뀌므로 다시 눌러도 되돌아가지 않는다. 템플릿 룩(ADR-0028) kit 부품만 쓴다.
 */
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';

export function ShipmentTrackingSwapForm({ shipmentId, reference, trackingNumber }: {
  shipmentId: string;
  /** 화면에 보이는 이 배송 건의 배송건번호(접근성 이름·확인 문구). */
  reference: string;
  /** 이 배송 건에 지금 등록된 대표 운송장번호. */
  trackingNumber: string;
}) {
  const router = useRouter(); const fieldId = useId();
  const [other, setOther] = useState(''); const [otherTracking, setOtherTracking] = useState(''); const [reason, setReason] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, startTransition] = useTransition();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const normalized = normalizeTrackingNumber(otherTracking);
    if (!other.trim()) { setError('맞바꿀 상대 배송건번호를 입력해주세요.'); return; }
    if (!isTrackingNumber(normalized)) { setError('상대 배송 건에 지금 등록된 운송장번호를 입력해주세요.'); return; }
    if (!reason.trim()) { setError('맞바꾸는 사유를 입력해주세요.'); return; }
    setError('');
    const confirmed = await adminConfirm({
      title: '운송장을 맞바꿀까요?',
      message: `두 배송 건의 운송장을 서로 바꿉니다. 이 배송 건(${reference}): ${trackingNumber} → ${normalized}. 상대 배송 건(${other.trim()}): ${normalized} → ${trackingNumber}. 고객 주문 상세의 배송조회가 바뀐 번호로 열리고, 두 배송 건 모두 감사 기록에 사유가 남습니다.`,
      confirmLabel: '맞바꾸기',
    });
    if (!confirmed) return;
    const form = new FormData();
    for (const [key, value] of Object.entries({ shipmentId, expectedTrackingNumber: trackingNumber, otherReference: other.trim(), otherTrackingNumber: normalized, reason: reason.trim() })) form.set(key, value);
    startTransition(async () => {
      try {
        const result = await swapShipmentTrackingAction(form);
        if (result.ok) { setOther(''); setOtherTracking(''); setReason(''); setNotice(result.message); router.refresh(); } else setError(result.error);
      } catch { setError('맞바꾼 결과를 확인하지 못했습니다. 화면을 새로고침해 두 배송 건의 운송장을 확인해주세요.'); }
    });
  }
  return <form className="flex w-full min-w-0 flex-col gap-2.5 text-sm" onSubmit={submit} aria-label={`배송 건 ${reference} 운송장 맞바꾸기`} data-shipment-tracking-swap="">
    <p className="text-xs text-muted-foreground">다른 주문과 운송장이 서로 뒤바뀌어 등록됐을 때만 씁니다. 상대 배송 건의 운송장이 이 배송 건의 실제 번호여야 합니다. 한쪽만 틀렸으면 위의 운송장 수정을 씁니다.</p>
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2">
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-other`}>상대 배송건번호</Label>
        <Input id={`${fieldId}-other`} value={other} autoComplete="off" maxLength={40} disabled={pending} placeholder="16자리 배송건번호" onChange={event => setOther(event.target.value)} /></div>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-tracking`}>상대 배송 건의 지금 운송장번호</Label>
        <Input id={`${fieldId}-tracking`} value={otherTracking} autoComplete="off" maxLength={40} disabled={pending} placeholder="이 배송 건의 실제 운송장번호" onChange={event => setOtherTracking(event.target.value)} /></div>
    </div>
    <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-reason`}>사유</Label>
      <Textarea id={`${fieldId}-reason`} rows={2} value={reason} maxLength={SHIPMENT_EXTRA_TRACKING_REASON_LIMIT} disabled={pending}
        placeholder="예: 김포 회신에서 두 주문의 운송장이 뒤바뀜(창고 확인)" onChange={event => setReason(event.target.value)} /></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button className="self-start" size="sm" type="submit" variant="outline" disabled={pending}>{pending ? '맞바꾸는 중…' : '운송장 맞바꾸기'}</Button>
  </form>;
}
