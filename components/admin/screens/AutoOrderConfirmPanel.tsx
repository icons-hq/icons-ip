'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { saveAutoOrderConfirmationAction, type AutoOrderConfirmationResult } from '@/app/admin/auto-order-confirmation-actions';
import { AdminField, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AUTO_ORDER_CONFIRMATION_EXCLUSIONS, AUTO_ORDER_CONFIRMATION_PATH, isAutoOrderRunTime, type AutoOrderConfirmationState } from '@/lib/admin/auto-order-confirmation';
import { adminOrderDetailHrefFromBack } from '@/lib/admin/orders';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';

const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';

/**
 * 자동 발주확인(ADR-0025) — 발주확인/발송관리 상단에서 상태를 보고 바로 바꾼다.
 * 결과가 불확실하면 입력과 요청 ID를 고정해 같은 요청으로만 다시 확인한다.
 */
export function AutoOrderConfirmPanel({ initial }: { initial: AutoOrderConfirmationState | null }) {
  const [state, setState] = useState(initial);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true), [runTime, setRunTime] = useState(initial?.runTime ?? '16:30');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ enabled: boolean; runTime: string; revision: number; id: string } | null>(null);
  if (!state) return <AdminSectionCard title="자동 발주확인"><p role="alert">자동 발주확인 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. 신규주문은 아래에서 직접 발주확인할 수 있습니다.</p></AdminSectionCard>;
  const current = state;
  const changed = enabled !== current.enabled || runTime !== current.runTime;
  async function save() {
    if (pending) return;
    if (!isAutoOrderRunTime(runTime)) { setMessage('실행 시각을 00:00~23:59 사이로 입력해주세요.'); setError(true); return; }
    request.current ??= { enabled, runTime, revision: current.revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: AutoOrderConfirmationResult;
    try { result = await saveAutoOrderConfirmationAction(request.current.enabled, request.current.runTime, request.current.revision, request.current.id); }
    catch { result = { error: UNKNOWN, uncertain: true }; }
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; return; }
    setState(result.state); setEnabled(result.state.enabled); setRunTime(result.state.runTime); setUncertain(false); setError(false); request.current = null;
    setMessage(result.state.enabled ? `저장했습니다. 매일 ${result.state.runTime}에 자동 발주확인합니다.` : '저장했습니다. 자동 발주확인을 껐습니다. 신규주문은 직접 발주확인합니다.');
  }
  const last = current.lastRun;
  const summary = [`매일 ${current.runTime}`, current.enabled ? '켜짐' : '꺼짐',
    last ? `마지막 실행 ${formatOrderDateTime(last.finishedAt ?? last.startedAt)}${last.finishedAt ? '' : '(진행 중)'} · 발주확인 ${last.confirmedCount.toLocaleString('ko-KR')}건 · 제외 ${last.excludedCount.toLocaleString('ko-KR')}건` : '아직 실행 기록 없음',
    current.nextRunAt ? `다음 실행 ${formatOrderDateTime(current.nextRunAt)}` : null].filter(Boolean).join(' · ');
  return <AdminSectionCard title="자동 발주확인" status={current.enabled ? '켜짐' : '꺼짐'} summary={summary}>
    <p>매일 설정한 시각까지 결제가 끝난 신규주문을 시스템이 발주확인합니다. 그 시각 뒤에 결제된 주문은 다음 날 처리하며, 발주확인 전까지 고객은 주문을 직접 취소할 수 있습니다.
      {current.enabled && current.enabledAt ? ` 켠 시각(${formatOrderDateTime(current.enabledAt)}) 전에 결제된 주문은 자동 대상이 아니므로 직접 발주확인합니다.` : ' 꺼져 있는 동안에는 신규주문을 직접 발주확인합니다.'}
      {' '}취소 요청이 진행 중이거나 예약 재고 할당 전인 주문은 신규주문에 남습니다.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={pending || uncertain}>
        <legend className="wc-admin-kit__hint">자동 발주확인 설정</legend>
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> 자동 발주확인 사용</label>
        <AdminField label="매일 실행 시각 (한국 시간)" inputId="auto-order-confirmation-time" hint="이 시각까지 결제 완료된 주문이 대상입니다. 오늘 아직 실행 전이면 바꾼 시각에(이미 지난 시각이면 1분 안에) 실행하고, 이미 실행한 날은 다시 실행하지 않습니다. 다시 켜면 켠 뒤 결제된 주문부터 대상이 됩니다.">
          <input id="auto-order-confirmation-time" type="time" step={60} required value={runTime} aria-describedby="auto-order-confirmation-time-hint" onChange={event => setRunTime(event.target.value.slice(0, 5))} />
        </AdminField>
      </fieldset>
      <div className="wc-admin-kit__actions">
        <button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</button>
        {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
      </div>
    </form>
    {current.lastExclusions.length ? <div>
      <p className="wc-admin-kit__hint">마지막 실행에서 신규주문에 남긴 주문 (최대 20건)</p>
      <ul>{current.lastExclusions.map(row => <li key={row.orderId}>
        <Link href={adminOrderDetailHrefFromBack(row.orderId, AUTO_ORDER_CONFIRMATION_PATH)}>주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</Link>{' '}
        <AdminStatusBadge tone={row.outcome === 'failed' ? 'danger' : 'warning'}>{AUTO_ORDER_CONFIRMATION_EXCLUSIONS[row.outcome]}</AdminStatusBadge>
      </li>)}</ul>
    </div> : null}
  </AdminSectionCard>;
}
