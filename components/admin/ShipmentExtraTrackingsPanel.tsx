'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { addShipmentExtraTrackingAction, removeShipmentExtraTrackingAction } from '@/app/admin/shipment-tracking-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { SHIPMENT_EXTRA_TRACKING_LIMIT, SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';
import { findShippingCarrier, isTrackingNumber, normalizeTrackingNumber, orderShipment, type ShippingCarrierRegistry } from '@/lib/orders/shipment';

/*
 * 배송 건 추가(연결) 운송장 관리(QNA-019). 부피가 큰 상품을 여러 상자로 나눠 보냈을 때 대표 운송장 말고 붙는 상자 번호를
 * 더하고 지운다 — 회신 파일 오기를 정정하거나 김포·택배사 분리배송을 기록한다. 사유는 필수이고 이력·감사 기록에 남는다.
 * 대표 운송장 정정은 지금처럼 운송장 수정에서 한다. 템플릿 룩(ADR-0028) kit 부품만 쓴다.
 */
export interface ShipmentExtraTrackingEntry { id: string; carrier: string; trackingNumber: string }

const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';
const NOTE_CLASS = 'text-xs text-muted-foreground';

function RemoveForm({ extra, label, onDone }: { extra: ShipmentExtraTrackingEntry; label: string; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null); const fieldId = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget);
    if (!String(form.get('reason') ?? '').trim()) { setError('지우는 사유를 입력해주세요.'); return; }
    requestId.current ??= crypto.randomUUID(); form.set('operationId', requestId.current); setError('');
    startTransition(async () => {
      try { const result = await removeShipmentExtraTrackingAction(form); if (result.ok) { requestId.current = null; onDone(result.message); } else setError(result.error); }
      catch { setError('삭제 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하거나 새로고침해주세요.'); }
    });
  }
  if (!open) return <Button size="sm" type="button" variant="outline" aria-label={`추가 운송장 ${label} 지우기`} onClick={() => setOpen(true)}>지우기</Button>;
  return <form className="flex w-full min-w-0 flex-col gap-2 rounded-lg border p-3" onSubmit={submit}>
    <input type="hidden" name="extraTrackingId" value={extra.id} />
    <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-reason`}>{label} 지우는 사유</Label>
      <Textarea id={`${fieldId}-reason`} name="reason" rows={2} maxLength={SHIPMENT_EXTRA_TRACKING_REASON_LIMIT} required disabled={pending} placeholder="예: 회신 파일의 번호 오기" /></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" type="submit" variant="destructive" disabled={pending}>{pending ? '지우는 중…' : '추가 운송장 지우기'}</Button>
      <Button size="sm" type="button" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setError(''); }}>취소</Button>
    </div>
  </form>;
}

/** 배송 건의 추가 운송장 목록과 추가·삭제 양식. 성공하면 서버 화면을 다시 읽어 목록이 바뀐다. */
export function ShipmentExtraTrackingsPanel({ shipmentId, reference, carriers, defaultCarrier, extras }: {
  shipmentId: string;
  /** 화면에 보이는 배송건번호(접근성 이름·결과 문구). */
  reference: string;
  carriers: ShippingCarrierRegistry;
  /** 대표 운송장의 택배사. 사용 중이면 미리 고른다. */
  defaultCarrier?: string | null;
  extras: readonly ShipmentExtraTrackingEntry[];
}) {
  const router = useRouter(); const fieldId = useId();
  const active = carriers.filter(carrier => carrier.active);
  const initialCarrier = active.some(carrier => carrier.code === defaultCarrier) ? defaultCarrier! : active.length === 1 ? active[0].code : '';
  const [carrier, setCarrier] = useState(initialCarrier); const [tracking, setTracking] = useState(''); const [reason, setReason] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);
  const full = extras.length >= SHIPMENT_EXTRA_TRACKING_LIMIT;
  const done = (message: string) => { setNotice(message); setError(''); router.refresh(); };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const trackingNumber = normalizeTrackingNumber(tracking);
    if (!carrier) { setError('택배사를 골라주세요.'); return; }
    if (!isTrackingNumber(trackingNumber)) { setError('운송장번호는 숫자·영문 8~30자로 입력해주세요.'); return; }
    if (!reason.trim()) { setError('추가하는 사유를 입력해주세요.'); return; }
    const form = new FormData();
    requestId.current ??= crypto.randomUUID();
    for (const [key, value] of Object.entries({ shipmentId, carrier, trackingNumber, reason: reason.trim(), operationId: requestId.current })) form.set(key, value);
    setError(''); setNotice('');
    startTransition(async () => {
      try {
        const result = await addShipmentExtraTrackingAction(form);
        if (result.ok) { requestId.current = null; setTracking(''); setReason(''); done(result.message); } else setError(result.error);
      } catch { setError('저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하거나 새로고침해주세요.'); }
    });
  }
  return <section className="flex w-full min-w-0 flex-col gap-3 text-sm" aria-label={`배송 건 ${reference} 추가 운송장`} data-shipment-extra-trackings-panel="">
    <p className={NOTE_CLASS}>여러 상자로 나눠 보낸 배송 건의 다른 상자 운송장입니다. 고객 주문 상세에 대표 운송장과 함께 보이고, 더하고 지울 때마다 사유가 기록에 남습니다.</p>
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    {extras.length ? <ul className="flex flex-col gap-2">{extras.map(extra => {
      const shown = orderShipment(carriers, extra.carrier, extra.trackingNumber);
      const label = `${findShippingCarrier(carriers, extra.carrier)?.label ?? extra.carrier} ${extra.trackingNumber}`;
      return <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" key={extra.id}>
        {shown ? <a className="tabular-nums underline underline-offset-4" href={shown.trackingUrl} rel="noreferrer noopener" target="_blank">{label}</a> : <span className="tabular-nums">{label}</span>}
        <RemoveForm extra={extra} label={label} onDone={done} />
      </li>;
    })}</ul> : <p className="text-muted-foreground">붙은 추가 운송장이 없습니다.</p>}
    {full ? <AdminNotice role="status" tone="neutral">추가 운송장은 배송 건마다 {SHIPMENT_EXTRA_TRACKING_LIMIT}개까지 붙일 수 있습니다.</AdminNotice> : <form className="flex w-full min-w-0 flex-col gap-2.5 border-t pt-3" onSubmit={submit}>
      <h3 className="text-sm font-medium text-foreground">추가 운송장 더하기</h3>
      <div className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-carrier`}>택배사</Label>
          <NativeSelect className="w-full" id={`${fieldId}-carrier`} value={carrier} disabled={pending} onChange={event => setCarrier(event.target.value)}>
            <option value="">택배사 선택</option>{active.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
          </NativeSelect></div>
        <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-tracking`}>운송장번호</Label>
          <Input id={`${fieldId}-tracking`} value={tracking} inputMode="text" autoComplete="off" maxLength={40} disabled={pending} placeholder="다른 상자의 운송장번호"
            onChange={event => setTracking(event.target.value)} /></div>
      </div>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-reason`}>사유</Label>
        <Textarea id={`${fieldId}-reason`} rows={2} value={reason} maxLength={SHIPMENT_EXTRA_TRACKING_REASON_LIMIT} disabled={pending}
          placeholder="예: 서원 분리배송 추가 운송장 확인" onChange={event => setReason(event.target.value)} /></div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button className="self-start" size="sm" type="submit" disabled={pending}>{pending ? '저장 중…' : '추가 운송장 저장'}</Button>
    </form>}
  </section>;
}

/** 목록 칸의 입구. 누르면 그 배송 건의 추가 운송장 팝업이 열린다(배송현황). */
export function ShipmentExtraTrackingsButton(props: Parameters<typeof ShipmentExtraTrackingsPanel>[0]) {
  const [open, setOpen] = useState(false);
  return <>
    <Button className="h-auto p-0" size="sm" type="button" variant="link" aria-haspopup="dialog" onClick={() => setOpen(true)}
      aria-label={`배송 건 ${props.reference} 추가 운송장 ${props.extras.length ? `${props.extras.length}개 관리` : '더하기'}`}>
      {props.extras.length ? `추가 운송장 ${props.extras.length}개 관리` : '추가 운송장 더하기'}
    </Button>
    {open ? <CustomerServiceDialog title={`추가 운송장 · 배송 건 ${props.reference}`} onClose={() => setOpen(false)}>
      <div className="overflow-y-auto px-4 py-3"><ShipmentExtraTrackingsPanel {...props} /></div>
    </CustomerServiceDialog> : null}
  </>;
}
