'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import {
  changeShipmentPreorderDateAction, readShipmentPreorderPromiseAction, type ShipmentPreorderPromise,
} from '@/app/admin/preorder-shipment-actions';
import { goodsShipDateLabel } from '@/lib/goods-preorders';

function PromiseEditor({ promise, onSaved }: { promise: ShipmentPreorderPromise; onSaved: (message: string) => void }) {
  const [date, setDate] = useState(promise.expectedShipDate ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await changeShipmentPreorderDateAction(data);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  return <form className="col wc-admin-kit" onSubmit={save} style={{ gap: 10 }}>
    <input type="hidden" name="shipmentId" value={promise.shipmentId} /><input type="hidden" name="updatedAt" value={promise.updatedAt} />
    <label>새 발송 예정일
      <input name="expectedShipDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={pending} />
    </label>
    <label>변경 사유
      <textarea name="reason" rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} required disabled={pending} />
    </label>
    <small className="muted">변경된 일정은 주문 화면에 반영하며, 원 예정일과 이전 변경 이력을 보존합니다.</small>
    {error && <p role="alert">{error}</p>}
    <button className="btn" type="submit" disabled={pending}>{pending ? '기록 중…' : '발송 예정일 변경 기록'}</button>
  </form>;
}

/** Staff-only server actions enforce access even when the component is invoked directly. */
export function ShipmentPreorderPromisePanel({ shipmentId }: { shipmentId: string }) {
  const [refresh, setRefresh] = useState(0);
  const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<{ shipmentId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; promise?: ShipmentPreorderPromise; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readShipmentPreorderPromiseAction(shipmentId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { key, promise: result.promise } : { key, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ key, error: '예약 발송 일정을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId]);
  const visible = loaded?.key === key ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const promise = visible?.promise;
  return <section className="card col wc-admin-kit" style={{ padding: 16, gap: 12 }} aria-labelledby={`shipment-promise-${shipmentId}`}>
    <h3 id={`shipment-promise-${shipmentId}`} style={{ margin: 0, fontSize: 16 }}>예약 발송 일정</h3>
    {notice?.shipmentId === shipmentId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">발송 일정을 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p> : promise ? <>
      {promise.originalExpectedShipDate ? <>
        <p style={{ margin: 0 }}>주문 당시: {goodsShipDateLabel(promise.originalExpectedShipDate)}<br />현재: {goodsShipDateLabel(promise.expectedShipDate)}</p>
        {promise.status === 'ready' ? <PromiseEditor key={`${promise.shipmentId}:${promise.updatedAt}`} promise={promise}
          onSaved={(message) => { setNotice({ shipmentId, message }); reload(); }} /> : <small className="muted">발송 준비를 마친 배송 건은 변경 이력을 확인할 수 있습니다.</small>}
        {promise.changes.length ? <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 10 }}>
          {promise.changes.map((change) => <li key={change.id}>
            <span>{change.fromDate} → {change.toDate}</span><p style={{ margin: '4px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{change.reason}</p>
            <small className="muted">{new Date(change.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {change.actorName ?? '운영자'}</small>
          </li>)}
        </ol> : <p className="muted">기록된 일정 변경이 없습니다.</p>}
      </> : <p className="muted">이 배송 건에는 예약 상품이 없습니다.</p>}
    </> : null}
    <button className="btn btn-ghost" type="button" onClick={reload}>예약 발송 일정 새로고침</button>
  </section>;
}
