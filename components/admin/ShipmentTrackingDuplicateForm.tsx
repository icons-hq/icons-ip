'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registerDuplicateShipmentTrackingAction } from '@/app/admin/shipment-tracking-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import { adminTrackingDuplicateRequest } from '@/lib/admin/order-confirmations';
import { topicParticle } from '@/lib/korean-particle';
import { SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';

/*
 * 중복 확인 후 운송장 등록(SHP-030 리뷰 2). 등록 판정은 다른 주문이 쓰는 운송장을 거절한다. 창고에 확인해 같은 상자가 맞으면(7일이
 * 지난 합배송 확인, 받는 분 표기가 달라 같은 집으로 묶이지 않은 경우 등) 사유를 적어 그 배송 건에 등록한다. 택배사 형식은 그대로 본다.
 * 발송 대기 건은 발송처리, 발송된 건은 운송장 정정이 된다. 사유·다른 주문의 쓰임은 승인·감사 기록에 남는다. 템플릿 룩(ADR-0028) kit 부품만 쓴다.
 * `fixed`를 주면(발송 대기 행에서 방금 거절된 번호) 택배사·번호는 그 값으로 고정하고 사유만 받는다.
 */
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';

export function ShipmentTrackingDuplicateForm({ shipmentId, reference, carriers, defaultCarrier, fixed, onDone, compact = false }: {
  shipmentId: string;
  /** 화면에 보이는 배송건번호(접근성 이름·확인 문구). */
  reference: string;
  /** 지금 고를 수 있는(사용 중) 택배사. */
  carriers: readonly { code: string; label: string }[];
  defaultCarrier?: string | null;
  fixed?: { carrier: string; trackingNumber: string };
  /** 성공 문구를 받는 쪽(발송 대기 표 위 알림). 없으면 양식 안에 보인다. */
  onDone?: (message: string) => void;
  compact?: boolean;
}) {
  const router = useRouter(); const fieldId = useId();
  const initialCarrier = carriers.some(carrier => carrier.code === defaultCarrier) ? defaultCarrier! : carriers.length === 1 ? carriers[0].code : '';
  const [carrier, setCarrier] = useState(initialCarrier); const [tracking, setTracking] = useState(''); const [reason, setReason] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, startTransition] = useTransition();
  const chosenCarrier = fixed?.carrier ?? carrier;
  const label = carriers.find(option => option.code === chosenCarrier)?.label ?? chosenCarrier;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const trackingNumber = normalizeTrackingNumber(fixed?.trackingNumber ?? tracking);
    if (!chosenCarrier) { setError('택배사를 골라주세요.'); return; }
    if (!isTrackingNumber(trackingNumber)) { setError('운송장번호는 하이픈을 뺀 8~30자리 영숫자입니다.'); return; }
    if (!reason.trim()) { setError('같은 상자로 확인한 사유를 입력해주세요.'); return; }
    setError('');
    const confirmed = await adminConfirm(adminTrackingDuplicateRequest({ reference, carrierLabel: label, trackingNumber }));
    if (!confirmed) return;
    const form = new FormData();
    for (const [key, value] of Object.entries({ shipmentId, carrier: chosenCarrier, trackingNumber, reason: reason.trim() })) form.set(key, value);
    startTransition(async () => {
      try {
        const result = await registerDuplicateShipmentTrackingAction(form);
        if (!result.ok) { setError(result.error); return; }
        setReason(''); setTracking('');
        if (onDone) onDone(result.message); else setNotice(result.message);
        router.refresh();
      } catch { setError('등록 결과를 확인하지 못했습니다. 화면을 새로고침해 배송 상태를 확인해주세요.'); }
    });
  }
  return <form className={`flex w-full min-w-0 flex-col ${compact ? 'gap-1.5 text-xs' : 'gap-2.5 text-sm'}`} onSubmit={submit} aria-label={`배송 건 ${reference} 중복 확인 후 운송장 등록`} data-shipment-tracking-duplicate="">
    <p className="text-xs text-muted-foreground">{fixed
      ? `${label} ${fixed.trackingNumber}${topicParticle(fixed.trackingNumber)} 다른 주문이 쓰는 번호입니다. 창고에 같은 상자로 확인했으면 사유를 적고 등록합니다.`
      : '다른 주문이 쓰는 번호라 등록이 거절됐지만 창고에 같은 상자로 확인한 경우에만 씁니다. 택배사 형식은 그대로 확인합니다.'}</p>
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    {fixed ? null : <div className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-carrier`}>택배사</Label>
        <NativeSelect className="w-full" id={`${fieldId}-carrier`} value={carrier} disabled={pending} onChange={event => setCarrier(event.target.value)}>
          <option value="">택배사 선택</option>{carriers.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
        </NativeSelect></div>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-tracking`}>운송장번호</Label>
        <Input id={`${fieldId}-tracking`} value={tracking} autoComplete="off" maxLength={40} disabled={pending} placeholder="다른 주문과 같은 상자의 운송장번호" onChange={event => setTracking(event.target.value)} /></div>
    </div>}
    <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-reason`}>같은 상자로 확인한 사유 (필수 · 감사 기록에 남습니다)</Label>
      <Textarea id={`${fieldId}-reason`} rows={2} value={reason} maxLength={SHIPMENT_EXTRA_TRACKING_REASON_LIMIT} disabled={pending}
        placeholder="예: 김포 확인 — 주문 2026111810000001과 한 상자로 합배송" onChange={event => setReason(event.target.value)} /></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button className="self-start" size={compact ? 'xs' : 'sm'} type="submit" variant="outline" disabled={pending}>{pending ? '등록 중…' : '중복 확인 후 등록'}</Button>
  </form>;
}
