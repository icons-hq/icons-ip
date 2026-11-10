'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console';
import { readRestrictionReleaseAction, releaseRestrictionsAction } from '@/app/admin/purchase-restriction-release-actions';
import { normalizeRestrictionRelease, type PurchaseRestrictionReleaseReceipt } from '@/lib/admin/purchase-restriction-release';
import { formatOrderDateTime } from '@/lib/orders';
import { ShortId } from '@/components/admin/sales/SalesConsole';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
/* 구매제한 선택 해제(템플릿 룩, ADR-0028). 해제 요청 고정·결과 조회 동작은 그대로다. */

export function PurchaseRestrictionReleaseResult({ receipt }: { receipt: PurchaseRestrictionReleaseReceipt }) {
  const count = (outcome: string) => receipt.rows.filter(row => row.outcome === outcome).length;
  return <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-sm text-card-foreground" aria-label="선택 해제 결과">
    <h3 className="text-base font-medium text-foreground">선택 해제 결과</h3><p role="status">해제 {count('released')}건 · 이미 해제 {count('already_released')}건 · 기록 없음 {count('not_found')}건</p>
    <p className="text-muted-foreground">처리 시각 {formatOrderDateTime(receipt.completedAt)} · 사유: {receipt.reason}</p>
    <ul className="flex flex-col gap-1 wrap-anywhere">{receipt.rows.map(row => <li key={row.id}>
      <ShortId value={row.id} /> · {row.outcome === 'released' ? '해제 완료' : row.outcome === 'already_released' ? '이미 해제된 기록' : '해당 기록 없음'}
      {row.customerRestricted ? <strong className="font-medium text-warning"> · 현재 다른 구매제한 기록이 있습니다.</strong> : null}
      {row.userId ? <> · <Link className="underline underline-offset-4" href={`/admin/customers/${row.userId}`}>고객 확인</Link></> : null}
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
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 print:hidden" data-sales-workbar=""><span className="text-muted-foreground tabular-nums">{ids.length}건 선택</span>
        <Button type="button" size="sm" variant="outline" disabled={!ids.length || pending} onClick={open}>선택건 구매제한 해제</Button>
      </div>
    </ConsoleGrid>
    {receipt ? <><PurchaseRestrictionReleaseResult receipt={receipt} /><Link className="self-start text-sm underline underline-offset-4" href={`${currentHref}&releaseBatch=${receipt.id}`}>이 해제 결과 다시 열기</Link></> : null}
    {operation ? <CustomerServiceDialog title="선택한 구매제한 해제" onClose={() => setOperation(null)} busy={pending || uncertain}>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <p>선택한 {operation.ids.length}개 기록을 해제합니다. 이미 해제된 기록과 찾을 수 없는 기록은 결과에서 구분합니다.</p>
      <form onSubmit={event => { event.preventDefault(); run(false); }} className="flex flex-col items-start gap-3">
        <label className="flex w-full min-w-0 flex-col gap-1.5 [&>span]:font-medium"><span>해제 사유</span><Input name="reason" required maxLength={200} value={reason} disabled={pending || uncertain || operation.reason !== undefined} onChange={event => setReason(event.target.value)} /></label>
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} required disabled={pending || uncertain || operation.reason !== undefined} onChange={event => setConfirmed(event.target.checked)} /><span>선택한 기록의 구매제한을 해제하는 데 동의합니다.</span></label>
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
        {uncertain ? <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => run(true)}>같은 요청 결과 조회</Button><Link className="underline underline-offset-4" href={`${currentHref}&releaseBatch=${operation.id}`}>결과 페이지 열기</Link></div>
          : <Button type="submit" disabled={pending || !confirmed || !reason.trim()}>{pending ? '해제 중…' : `${operation.ids.length}건 구매제한 해제`}</Button>}
      </form>
      </div>
    </CustomerServiceDialog> : null}
  </>;
}
