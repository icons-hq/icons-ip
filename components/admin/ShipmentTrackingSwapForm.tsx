'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { searchTrackingSwapCandidatesAction, type TrackingSwapCandidate } from '@/app/admin/shipment-tracking-lookup-actions';
import { swapShipmentTrackingAction } from '@/app/admin/shipment-tracking-actions';
import { AdminPickedBox, useAdminPickedValue } from '@/components/admin/AdminPickedValue';
import { AdminPickerDialog } from '@/components/admin/console/AdminPickerDialog';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import { adminTrackingSwapRequest } from '@/lib/admin/order-confirmations';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';

/*
 * 뒤바뀐 운송장 맞바꾸기(SHP-031). 창고가 두 주문의 운송장을 서로 바꿔 회신해 그대로 등록됐으면, 운송장 정정은 상대 번호가 다른 주문에
 * 쓰였다며 거절한다. 그때 상대 배송 건을 고르면(운송장번호로 찾는다 — 배송건번호·운송장번호를 글자로 적지 않는다) 두 대표 운송장을
 * 한 번에 맞바꾼다. 화면이 본 번호가 지금 값과 같을 때만 바뀌므로 다시 눌러도 되돌아가지 않는다. 템플릿 룩(ADR-0028) kit 부품만 쓴다.
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
  /* 고른 상대 배송 건. 값(배송 건 내부 번호)은 숨은 칸에만 두고 화면에는 번호·수령인·운송장으로 보인다. */
  const picked = useAdminPickedValue('');
  const [other, setOther] = useState<TrackingSwapCandidate | null>(null); const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, startTransition] = useTransition();
  /* 선택창은 가장 최근에 받은 조회 함수를 쓰므로 매번 새로 만들어도 된다. 이 배송 건 자신은 조회에서 빠진다. */
  const load: AdminPickerLoader<TrackingSwapCandidate> = async (request) => {
    const result = await searchTrackingSwapCandidatesAction(shipmentId, { query: request.query, page: request.page });
    return result.ok ? result.data : { error: result.error };
  };
  const pickedText = other ? `배송 건 ${other.reference} · 주문 ${other.orderReference} · ${other.carrierLabel} ${other.trackingNumber}` : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    if (!other) { setError('맞바꿀 상대 배송 건을 골라주세요.'); return; }
    if (!reason.trim()) { setError('맞바꾸는 사유를 입력해주세요.'); return; }
    setError('');
    const confirmed = await adminConfirm(adminTrackingSwapRequest({ reference, trackingNumber, otherReference: other.reference, otherTrackingNumber: other.trackingNumber }));
    if (!confirmed) return;
    const form = new FormData();
    for (const [key, value] of Object.entries({ shipmentId, expectedTrackingNumber: trackingNumber, otherReference: other.id, otherTrackingNumber: other.trackingNumber, reason: reason.trim() })) form.set(key, value);
    startTransition(async () => {
      try {
        const result = await swapShipmentTrackingAction(form);
        if (result.ok) { setOther(null); picked.setValue(''); setReason(''); setNotice(result.message); router.refresh(); } else setError(result.error);
      } catch { setError('맞바꾼 결과를 확인하지 못했습니다. 화면을 새로고침해 두 배송 건의 운송장을 확인해주세요.'); }
    });
  }
  return <form className="flex w-full min-w-0 flex-col gap-2.5 text-sm" onSubmit={submit} aria-label={`배송 건 ${reference} 운송장 맞바꾸기`} data-shipment-tracking-swap="">
    <p className="text-xs text-muted-foreground">두 주문의 운송장이 서로 뒤바뀌어 등록됐을 때만 씁니다. 상대 배송 건의 운송장이 이 배송 건의 실제 번호여야 합니다.</p>
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-other`}>상대 배송 건</Label>
      <AdminPickedBox inputId={`${fieldId}-other`} name="otherShipment" value={picked.value} inputRef={picked.inputRef} text={pickedText}
        placeholder="이 배송 건의 실제 운송장번호를 쓰는 배송 건을 골라주세요" pickLabel="상대 배송 건 고르기" onOpen={() => { if (!pending) setOpen(true); }} locked={pending} /></div>
    <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-reason`}>맞바꾸는 사유 (필수 · 감사 기록에 남습니다)</Label>
      <Textarea id={`${fieldId}-reason`} rows={2} value={reason} maxLength={SHIPMENT_EXTRA_TRACKING_REASON_LIMIT} disabled={pending}
        placeholder="예: 김포 회신에서 두 주문의 운송장이 뒤바뀜(창고 확인)" onChange={event => setReason(event.target.value)} /></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button className="self-start" size="sm" type="submit" variant="outline" disabled={pending}>{pending ? '맞바꾸는 중…' : '운송장 맞바꾸기'}</Button>
    {open ? <AdminPickerDialog title="상대 배송 건 고르기" description="이 배송 건의 실제 운송장번호가 지금 등록돼 있는 배송 건을 운송장번호로 찾아 고릅니다. 운송장번호는 8자 이상 적어주세요."
      load={load} rowKey={row => row.id} unit="건" searchPlaceholder="운송장번호"
      rowView={row => ({ title: `배송 건 ${row.reference}`, meta: `${row.originName} · 주문 ${row.orderReference} · ${row.recipientName ?? '수령인 없음'} · ${row.carrierLabel} ${row.trackingNumber}` })}
      excludedNote="이 배송 건 자신과 운송장이 없는 배송 건은 목록에서 뺐습니다."
      emptyText="운송장번호를 8자 이상 적어 검색하면 그 번호를 쓰는 배송 건이 나옵니다."
      onSelect={row => { setOther(row); picked.setValue(row.id); setError(''); }} onClose={() => setOpen(false)} /> : null}
  </form>;
}
