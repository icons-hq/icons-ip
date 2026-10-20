'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console';
import { readRestrictionReleaseAction, releaseRestrictionsAction } from '@/app/admin/purchase-restriction-release-actions';
import { normalizeRestrictionRelease, type PurchaseRestrictionReleaseReceipt } from '@/lib/admin/purchase-restriction-release';
import { formatOrderDateTime } from '@/lib/orders';
import { CustomerServiceDialog } from './CustomerServiceDialog';

export function PurchaseRestrictionReleaseResult({ receipt }: { receipt: PurchaseRestrictionReleaseReceipt }) {
  const count = (outcome: string) => receipt.rows.filter(row => row.outcome === outcome).length;
  return <section className="admin-purchase-restriction-register" aria-label="선택 해제 결과">
    <h3>선택 해제 결과</h3><p role="status">해제 {count('released')}건 · 이미 해제 {count('already_released')}건 · 기록 없음 {count('not_found')}건</p>
    <p>처리 시각 {formatOrderDateTime(receipt.completedAt)} · 사유: {receipt.reason}</p>
    <ul>{receipt.rows.map(row => <li key={row.id}>
      <span className="mono">{row.id}</span> · {row.outcome === 'released' ? '해제 완료' : row.outcome === 'already_released' ? '이미 해제된 기록' : '해당 기록 없음'}
      {row.customerRestricted ? <strong> · 현재 다른 구매제한 기록이 있습니다.</strong> : null}
      {row.userId ? <> · <Link href={`/admin/customers/${row.userId}`}>고객 확인</Link></> : null}
    </li>)}</ul>
  </section>;
}
export function PurchaseRestrictionReleaseGrid({ columns, rows, currentHref, initialReceipt = null }: {
  columns: ConsoleGridColumn[]; rows: ConsoleGridRow[]; currentHref: string; initialReceipt?: PurchaseRestrictionReleaseReceipt | null;
}) {
  const router = useRouter(); const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState<{ id: string; ids: string[]; reason?: string } | null>(null);
  const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition(); const dispatching = useRef(false);
  const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(initialReceipt);
  const eligible = new Set(rows.filter(row => row.selectable !== false).map(row => row.id));
  const ids = selected.filter(id => eligible.has(id));
  function open() {
    setOperation({ id: crypto.randomUUID(), ids: [...ids] }); setReason(''); setConfirmed(false); setError(''); setUncertain(false);
  }
  function run(readOnly: boolean) {
    if (!operation || pending || dispatching.current || (!readOnly && uncertain)) return;
    const request = normalizeRestrictionRelease(operation.id, operation.ids, operation.reason ?? reason);
    if ('error' in request) { setError(request.error); return; }
    // Freeze before dispatch. A result lookup may win the lock before a delayed
    // request arrives, so a not-found lookup never permits changing its payload.
    if (!readOnly && operation.reason === undefined) {
      setOperation({ ...operation, reason: request.value.reason }); setReason(request.value.reason);
    }
    dispatching.current = true; setError('');
    startTransition(async () => {
      try {
        const result = readOnly ? await readRestrictionReleaseAction(operation.id) : await releaseRestrictionsAction(request.value.id, request.value.ids, request.value.reason, confirmed);
        if ('error' in result) { setError(result.error); setUncertain(Boolean(result.uncertain)); }
        else if (!result.receipt) { setUncertain(false); setError('이 요청으로 저장된 해제 결과가 없습니다. 같은 대상과 사유로 다시 실행할 수 있습니다.'); }
        else { setReceipt(result.receipt); setUncertain(false); setOperation(null); setSelected([]); router.refresh(); }
      } catch { setError('연결이 끊겨 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.'); setUncertain(true); }
      finally { dispatching.current = false; }
    });
  }
  return <>
    <ConsoleGrid caption="판매방해 고객 구매제한 목록" preferencesKey="sales-purchase-restrictions" columns={columns} rows={rows}
      emptyLabel="검색 조건에 맞는 구매제한 기록이 없습니다." selectable selectedIds={ids} onSelectionChange={next => { if (!operation) setSelected(next); }}>
      <div className="admin-sales-workbar"><span className="admin-sales-selection">{ids.length}건 선택</span>
        <button type="button" className="wc-admin-kit__button" disabled={!ids.length || pending} onClick={open}>선택건 해제하기</button>
      </div>
    </ConsoleGrid>
    {receipt ? <><PurchaseRestrictionReleaseResult receipt={receipt} /><Link href={`${currentHref}&releaseBatch=${receipt.id}`}>이 해제 결과 다시 열기</Link></> : null}
    {operation ? <CustomerServiceDialog title="선택한 구매제한 해제" onClose={() => setOperation(null)} busy={pending || uncertain}>
      <p>선택한 {operation.ids.length}개 기록을 해제합니다. 이미 해제된 기록과 찾을 수 없는 기록은 결과에서 구분합니다.</p>
      <form onSubmit={event => { event.preventDefault(); run(false); }} className="admin-purchase-restriction-form">
        <label>해제 사유<input name="reason" required maxLength={200} value={reason} disabled={pending || uncertain || operation.reason !== undefined} onChange={event => setReason(event.target.value)} /></label>
        <label className="admin-purchase-restriction-confirm"><input type="checkbox" checked={confirmed} required disabled={pending || uncertain || operation.reason !== undefined} onChange={event => setConfirmed(event.target.checked)} />선택한 기록의 구매제한을 해제하는 데 동의합니다.</label>
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        {uncertain ? <><button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => run(true)}>같은 요청 결과 조회</button><Link href={`${currentHref}&releaseBatch=${operation.id}`}>결과 페이지 열기</Link></>
          : <button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !confirmed || !reason.trim()}>{pending ? '해제 중…' : `${operation.ids.length}건 구매제한 해제`}</button>}
      </form>
    </CustomerServiceDialog> : null}
  </>;
}
