'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registerShipmentTrackingAction } from '@/app/admin/shipment-actions';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { useShipmentConsoleActions } from './ShipmentConsoleContext';

/*
 * 발송 대기 행의 택배사·운송장 칸(S36-072, "그 자리 저장"). 창고 회신 파일과 같은 등록 경로라
 * 합포장은 묶음 전체에 적용되고 이미 발송된 운송장은 덮어쓰지 않는다. 등록에 성공한 행은 배송 중으로
 * 넘어가 목록에서 빠지므로 결과 문구는 표 위 알림으로 올린다.
 */
export function ShipmentConsoleRowTracking({ shipmentId, reference, carriers, defaultCarrier }: {
  shipmentId: string;
  /** 화면에 보이는 배송건번호. 접근성 이름과 결과 문구에 쓴다. */
  reference: string;
  /** 지금 고를 수 있는(사용 중) 택배사. */
  carriers: readonly { code: string; label: string }[];
  /** 출고지 기본 택배사. 사용 중일 때만 미리 고른다. */
  defaultCarrier?: string | null;
}) {
  const actions = useShipmentConsoleActions();
  const router = useRouter();
  const fieldId = useId();
  const initialCarrier = carriers.some((carrier) => carrier.code === defaultCarrier) ? defaultCarrier! : carriers.length === 1 ? carriers[0].code : '';
  const [carrier, setCarrier] = useState(initialCarrier);
  const [tracking, setTracking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trackingNumber = normalizeTrackingNumber(tracking);
    if (!carrier) { setError('택배사를 골라주세요.'); return; }
    if (!isTrackingNumber(trackingNumber)) { setError('운송장번호는 하이픈을 뺀 8~30자리 영숫자입니다.'); return; }
    setError(''); setNotice('');
    startTransition(async () => {
      try {
        const result = await registerShipmentTrackingAction([{ shipmentId, carrier, trackingNumber }]);
        if (!result.ok) { setError(result.error); return; }
        if (result.failed.length) { setError(result.failed[0].reason); return; }
        const message = `배송 건 ${reference}: ${result.message}`;
        if (actions) actions.report({ tone: result.queueWarning ? 'warning' : 'success', message });
        else setNotice(message);
        setTracking('');
        router.refresh();
      } catch {
        setError('등록 결과를 확인하지 못했습니다. 목록을 새로고침해 배송 상태를 확인해주세요.');
      }
    });
  }

  if (!carriers.length) return <span className="text-xs text-muted-foreground">사용 중인 택배사가 없습니다.</span>;
  /* 1440 화면에서 표가 넘치지 않게 택배사 위, 운송장·등록 아래로 쌓는다. */
  return <form className="flex w-40 min-w-0 flex-col gap-1" data-shipment-row-tracking="" noValidate onSubmit={submit}>
    <NativeSelect aria-label={`배송 건 ${reference} 택배사`} className="w-full" disabled={pending} id={`${fieldId}-carrier`} onChange={(event) => setCarrier(event.target.value)} size="sm" value={carrier}>
      <option value="">택배사 선택</option>
      {carriers.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
    </NativeSelect>
    <div className="flex min-w-0 items-center gap-1">
      <Input aria-describedby={error ? `${fieldId}-error` : undefined} aria-invalid={error ? true : undefined} aria-label={`배송 건 ${reference} 운송장번호`} autoComplete="off"
        className="h-7 min-w-0 flex-1 px-2 text-xs tabular-nums md:text-xs" disabled={pending} id={`${fieldId}-tracking`} maxLength={40} onChange={(event) => setTracking(event.target.value)}
        placeholder="운송장번호" spellCheck={false} value={tracking} />
      <Button disabled={pending} size="xs" type="submit">{pending ? '등록 중' : '등록'}</Button>
    </div>
    {error ? <p className="text-xs text-destructive" id={`${fieldId}-error`} role="alert">{error}</p> : null}
    {notice ? <p className="text-xs text-success" role="status">{notice}</p> : null}
  </form>;
}
