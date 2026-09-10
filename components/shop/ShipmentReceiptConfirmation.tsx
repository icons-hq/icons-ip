'use client';

import { useEffect, useState, useTransition } from 'react';
import { issueShipmentReceiptConfirmationAction } from '@/app/shipments/receipt-actions';
import { formatOrderDateTime } from '@/lib/orders';

export function ShipmentReceiptConfirmation({ shipmentId }: { shipmentId: string }) {
  const [issued, setIssued] = useState<{ shipmentId: string; code: string; expiresAt: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = issued?.shipmentId === shipmentId ? issued : null;
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(visible.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [visible]);
  function issue() {
    if (pending) return;
    setError(null); setIssued(null);
    startTransition(async () => {
      const result = await issueShipmentReceiptConfirmationAction(shipmentId);
      if (result.ok) { setExpired(false); setIssued({ shipmentId, code: result.code, expiresAt: result.expiresAt }); }
      else setError(result.error);
    });
  }
  return <section className="col" style={{ gap: 8 }} aria-label="일회 수령 확인">
    <p style={{ margin: 0 }}>물품을 직접 확인한 뒤 담당자에게 수령 확인값을 보여주세요. 주문한 계정에서만 발급할 수 있습니다.</p>
    {visible && !expired ? <div role="status">
      <strong style={{ fontSize: 24, letterSpacing: 2, overflowWrap: 'anywhere' }}>{visible.code.match(/.{1,4}/g)?.join('-')}</strong>
      <p className="muted" style={{ margin: '4px 0' }}>{formatOrderDateTime(visible.expiresAt)}까지 유효</p>
    </div> : expired && visible ? <p role="status">수령 확인값이 만료되었습니다. 다시 발급해주세요.</p> : null}
    <small className="muted">10분 안에 1회 사용할 수 있으며, 5회 틀리면 다시 발급해야 합니다. 재발급하면 이전 값은 사용할 수 없습니다.</small>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={issue}>
      {pending ? '발급 중…' : visible ? '수령 확인값 다시 발급' : '일회 수령 확인값 발급'}
    </button>
  </section>;
}
