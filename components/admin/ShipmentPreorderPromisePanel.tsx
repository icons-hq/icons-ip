'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import {
  changeShipmentPreorderDateAction, readShipmentPreorderPromiseAction, type ShipmentPreorderPromise, type ShipmentPromiseChange,
} from '@/app/admin/preorder-shipment-actions';
import { kstToday } from '@/components/admin/console/date-presets';
import { adminConfirm, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { formatOrderDateTime } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';

/* 예약 발송 일정 카드(템플릿 룩, ADR-0028). */
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:font-medium';

/**
 * [발송 예정일 바꾸기]의 확인창. 바뀐 예정일은 고객 주문 화면에 바로 보이는데 고객에게 알림은 가지 않는다 —
 * 화면에 보이지 않는 이 결과만 말한다(주문 당시 예정일과 이전 변경 이력은 그대로 남는다).
 */
export function preorderDateConfirmRequest({ from, to }: { from: string | null; to: string }): AdminConfirmRequest {
  return {
    title: '발송 예정일을 바꿀까요?',
    message: `${goodsShipDateLabel(from)} → ${goodsShipDateLabel(to)}\n고객 주문 화면에 바뀐 예정일이 바로 보입니다. 고객에게 알림은 가지 않습니다.`,
    confirmLabel: '예정일 바꾸기', cancelLabel: '돌아가기',
  };
}

export function PromiseEditor({ promise, onSaved }: { promise: ShipmentPreorderPromise; onSaved: (message: string) => void }) {
  const [date, setDate] = useState(promise.expectedShipDate ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  /* 같은 날짜로는 바꿀 수 없다(바뀐 게 없으면 서버도 '이미 같은 날짜'로 끝낸다). 지난 날짜는 달력에서 고를 수 없게 막는다. */
  const unchanged = date === (promise.expectedShipDate ?? '');
  const lockNote = !date || unchanged ? '다른 날짜를 고르면 누를 수 있습니다.' : !reason.trim() ? '바꾸는 이유를 적으면 누를 수 있습니다.' : null;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (pending || lockNote) return;
    const data = new FormData(event.currentTarget);
    if (!await adminConfirm(preorderDateConfirmRequest({ from: promise.expectedShipDate, to: date }))) return;
    startTransition(async () => {
      const result = await changeShipmentPreorderDateAction(data);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  return <form className="flex w-full flex-col items-start gap-2.5" onSubmit={save}>
    <input type="hidden" name="orderId" value={promise.orderId} /><input type="hidden" name="shipmentId" value={promise.shipmentId} /><input type="hidden" name="updatedAt" value={promise.updatedAt} />
    <label className={FIELD_CLASS}><span>새 발송 예정일</span>
      <Input className="w-44" name="expectedShipDate" type="date" min={kstToday()} value={date} onChange={(event) => setDate(event.target.value)} required disabled={pending} />
    </label>
    <label className={FIELD_CLASS}><span>바꾸는 이유 (필수)</span>
      <Textarea name="reason" rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 공장 입고가 늦어져 일정을 미룸" required disabled={pending} />
      <small className="text-xs font-normal text-muted-foreground">변경 이력과 발송관리의 지연 메모에 보입니다.</small>
    </label>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending || Boolean(lockNote)}>{pending ? '바꾸는 중…' : '발송 예정일 바꾸기'}</Button>
      {!pending && lockNote ? <small className="text-xs text-muted-foreground" data-promise-lock-note="">{lockNote}</small> : null}
    </div>
  </form>;
}

/** 변경 이력 한 줄의 머리말. 일괄 변경으로 남은 행은 출처를 밝히고, 일정 그대로 안내만 한 행은 'A → A' 대신 안내만 했다는 뜻을 보인다. */
export function PromiseChangeHeadline({ change }: { change: ShipmentPromiseChange }) {
  if (change.noticeOnly) return <>
    <span className="font-medium">고객 안내만(일정 그대로) · 예약 주문 일괄 변경</span>
    <span className="ml-2 tabular-nums text-muted-foreground">{change.toDate}</span>
  </>;
  return <span className="tabular-nums">{change.fromDate} → {change.toDate}
    {change.bulkChangeId ? <span className="text-muted-foreground"> · 예약 주문 일괄 변경</span> : null}</span>;
}

/** Staff-only server actions enforce access even when the component is invoked directly. */
export function ShipmentPreorderPromisePanel({ shipmentId, orderId }: { shipmentId: string; orderId: string }) {
  const [refresh, setRefresh] = useState(0);
  const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<{ shipmentId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; promise?: ShipmentPreorderPromise; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readShipmentPreorderPromiseAction(shipmentId, orderId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { key, promise: result.promise } : { key, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ key, error: '예약 발송 일정을 불러오지 못했습니다. [예약 발송 일정 새로고침]을 눌러주세요.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId, orderId]);
  const visible = loaded?.key === key ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const promise = visible?.promise;
  return <section className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground" aria-labelledby={`shipment-promise-${shipmentId}`}>
    <h3 className="text-base font-medium text-foreground" id={`shipment-promise-${shipmentId}`}>예약 발송 일정</h3>
    {notice?.shipmentId === shipmentId && <p className="text-success" role="status">{notice.message}</p>}
    {!visible ? <p className="text-muted-foreground" role="status">발송 일정을 불러오는 중입니다…</p> : visible.error ? <p className="text-destructive" role="alert">{visible.error}</p> : promise ? <>
      {promise.originalExpectedShipDate ? <>
        <p>주문 당시: {goodsShipDateLabel(promise.originalExpectedShipDate)}<br />현재: {goodsShipDateLabel(promise.expectedShipDate)}</p>
        {promise.status === 'ready' ? <PromiseEditor key={`${promise.shipmentId}:${promise.updatedAt}`} promise={promise}
          onSaved={(message) => { setNotice({ shipmentId, message }); reload(); }} /> : <small className="text-xs text-muted-foreground">발송 대기가 아닌 배송 건은 예정일을 바꿀 수 없고 변경 이력만 볼 수 있습니다.</small>}
        {promise.changes.length ? <ol className="flex list-decimal flex-col gap-2.5 pl-5">
          {promise.changes.map((change) => <li key={change.id}>
            <PromiseChangeHeadline change={change} /><p className="my-1 whitespace-pre-wrap wrap-anywhere">{change.reason}</p>
            <small className="text-xs text-muted-foreground">{formatOrderDateTime(change.changedAt)} · {change.actorName ?? '운영자'}</small>
          </li>)}
        </ol> : <p className="text-muted-foreground">기록된 일정 변경이 없습니다.</p>}
      </> : <p className="text-muted-foreground">이 배송 건에는 예약 상품이 없습니다.</p>}
    </> : null}
    <Button variant="outline" size="sm" type="button" onClick={reload}>예약 발송 일정 새로고침</Button>
  </section>;
}
