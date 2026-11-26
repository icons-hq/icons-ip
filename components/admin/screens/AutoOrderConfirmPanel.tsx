'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { saveAutoOrderConfirmationAction, type AutoOrderConfirmationResult } from '@/app/admin/auto-order-confirmation-actions';
import { AdminHelpTip } from '@/components/admin/console/AdminHelpTip';
import { AdminField, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesDisclosureCard } from '@/components/admin/sales/SalesConsole';
import { AUTO_ORDER_CONFIRMATION_EXCLUSIONS, AUTO_ORDER_CONFIRMATION_PATH, isAutoOrderRunTime, type AutoOrderConfirmationState } from '@/lib/admin/auto-order-confirmation';
import { SALES_AUTO_ORDER_CONFIRM_HELP } from '@/lib/admin/help/sales-auto-order-confirm';
import { adminOrderDetailHrefFromBack } from '@/lib/admin/orders';
import { adminOrderPreviewHref } from '@/lib/admin/order-preview';
import { OrderPreviewLink, OrderPreviewNewTabLink } from './OrderPreview';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

/** KST 날짜·시간을 한 덩어리(줄바꿈 없음)로 보인다. */
const dateTimeText = (value: string) => <span className="whitespace-nowrap tabular-nums">{formatOrderDateTime(value)}</span>;

/* 결과를 모를 때의 말(낱말 표). 서버가 돌려주는 같은 뜻의 옛 문구는 이 문장으로 바꿔 보인다. */
const UNKNOWN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
/* 주문 표 위 단계 이름 줄의 켜짐·꺼짐이 이 자리로 내려온다. */
const AUTO_ORDER_CONFIRM_ANCHOR = 'auto-order-confirm';

/**
 * 자동 발주확인(ADR-0025) — 발주확인/발송관리의 주문 표 아래에서 켜짐·꺼짐과 실행 결과를 한 줄로 보고, 펼쳐서 바꾼다.
 * 펼친 안쪽은 설명 문단 대신 지금 고른 값이 가져올 결과를 한 줄로 되읽는다(바꾸고 저장 전이면 '저장하면'). 어떤 주문이 대상에서 빠지는지는 "?" 한 곳이 말한다.
 * 끄면 실행 시각 칸은 필요 없어 보이지 않는다.
 * 접어도 입력은 DOM과 상태에 남고, 저장은 양식 값이 아니라 이 패널의 상태로 보낸다.
 * 결과가 불확실하면 입력과 요청 ID를 고정해 같은 요청으로만 다시 확인한다.
 * 저장 뒤 revalidatePath·router.refresh로 서버가 새 설정을 다시 그려도 패널을 다시 마운트하지 않는다 —
 * 새 설정이 지금 것보다 오래되지 않았을 때 표시 상태만 맞추고, 저장 결과 문구와 포커스는 남긴다.
 */
export function AutoOrderConfirmPanel({ initial, listHref = AUTO_ORDER_CONFIRMATION_PATH }: { initial: AutoOrderConfirmationState | null;
  /** 이 패널이 놓인 발주·발송 목록 주소(현재 조건). 남긴 주문은 이 목록 위 상세 팝업(S36-075)으로 연다. */
  listHref?: string }) {
  const [state, setState] = useState(initial);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true), [runTime, setRunTime] = useState(initial?.runTime ?? '16:30');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ enabled: boolean; runTime: string; revision: number; id: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null), resultRef = useRef<HTMLParagraphElement>(null), focusResult = useRef(false);
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    // 늦게 도착한 이전 설정(revision이 더 낮은 렌더)은 무시한다. 고치던 입력은 덮어쓰지 않는다.
    if (initial && (!state || initial.revision >= state.revision)) {
      if (!state || (enabled === state.enabled && runTime === state.runTime)) { setEnabled(initial.enabled); setRunTime(initial.runTime); }
      setState(initial);
    }
  }
  // 저장 중에는 입력과 버튼이 잠겨 포커스가 빠진다. 결과가 나오면 그 문구로 포커스를 옮긴다(다른 곳으로 옮긴 경우 제외).
  useEffect(() => {
    if (!focusResult.current) return;
    focusResult.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || formRef.current?.contains(active)) resultRef.current?.focus();
  });
  if (!state) return <div className="scroll-mt-16" id={AUTO_ORDER_CONFIRM_ANCHOR}><AdminNotice role="alert" title="자동 발주확인" tone="danger">자동 발주확인 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. 신규주문은 위 목록에서 직접 발주확인할 수 있습니다.</AdminNotice></div>;
  const current = state;
  /* 끄면 실행 시각 칸은 보이지 않는다 — 끈 채로 시각만 바꾼 것은 바뀐 것으로 세지 않는다. */
  const changed = enabled !== current.enabled || (enabled && runTime !== current.runTime);
  async function save() {
    if (pending) return;
    /* 끄는 저장은 시각을 쓰지 않는다. 숨은 칸이 비어 있어도 막지 않고 저장돼 있던 시각을 그대로 보낸다. */
    const time = isAutoOrderRunTime(runTime) ? runTime : enabled ? null : current.runTime;
    if (!time) { setMessage('실행 시각을 00:00~23:59 사이로 입력해주세요.'); setError(true); return; }
    request.current ??= { enabled, runTime: time, revision: current.revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: AutoOrderConfirmationResult;
    try { result = await saveAutoOrderConfirmationAction(request.current.enabled, request.current.runTime, request.current.revision, request.current.id); }
    catch { result = { error: UNKNOWN, uncertain: true }; }
    setPending(false); focusResult.current = true;
    if ('error' in result) { setMessage(result.uncertain ? UNKNOWN : result.error); setError(true); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; return; }
    setState(result.state); setEnabled(result.state.enabled); setRunTime(result.state.runTime); setUncertain(false); setError(false); request.current = null;
    setMessage(result.state.enabled ? `저장했습니다. 매일 ${result.state.runTime}에 자동 발주확인합니다.` : '저장했습니다. 자동 발주확인을 껐습니다. 신규주문은 직접 발주확인합니다.');
  }
  const last = current.lastRun;
  /* 날짜·시각은 좁은 화면에서도 한 덩어리로 둔다('2026. / 11. 6.'처럼 갈리지 않게). 글자는 그대로다. */
  const summary = ([`매일 ${current.runTime}`,
    last ? <>마지막 실행 {dateTimeText(last.finishedAt ?? last.startedAt)}{last.finishedAt ? '' : '(진행 중)'} · 발주확인 {last.confirmedCount.toLocaleString('ko-KR')}건 · 제외 {last.excludedCount.toLocaleString('ko-KR')}건</> : '아직 실행 기록 없음',
    current.nextRunAt ? <>다음 실행 {dateTimeText(current.nextRunAt)}</> : null].filter(Boolean) as ReactNode[])
    .map((part, index) => <Fragment key={index}>{index ? ' · ' : null}{part}</Fragment>);
  return <SalesDisclosureCard id={AUTO_ORDER_CONFIRM_ANCHOR} status={<AdminStatusBadge tone={current.enabled ? 'success' : 'warning'}>{current.enabled ? '켜짐' : '꺼짐'}</AdminStatusBadge>} summary={summary} title="자동 발주확인">
    {/* 켜고 끌 때 무엇이 달라지는지를 지금 고른 값으로 한 줄에 되읽는다. 바꾸고 아직 저장하지 않았으면 '저장하면'으로 시작한다. */}
    <p className="text-foreground" data-auto-order-readback="">{enabled
      ? `${changed ? '저장하면 ' : ''}${isAutoOrderRunTime(runTime) ? `매일 ${runTime}에` : '매일 실행 시각에'}, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.${!current.enabled ? ' 지금 신규주문에 있는 주문은 직접 발주확인합니다.' : ''}`
      : current.enabled ? '저장하면 자동 발주확인을 끕니다. 신규주문은 직접 발주확인합니다.' : '자동 발주확인이 꺼져 있습니다. 신규주문은 직접 발주확인합니다.'}</p>
    <form className="flex flex-col gap-4" ref={formRef} onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending || uncertain}>
        <legend className="sr-only">자동 발주확인 설정</legend>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> 자동 발주확인 사용</label>
          <AdminHelpTip help={SALES_AUTO_ORDER_CONFIRM_HELP.targets} label="자동 발주확인 대상" />
        </div>
        {enabled ? <AdminField label="매일 실행 시각 (KST)" inputId="auto-order-confirmation-time" hint="오늘 아직 실행 전이면 바꾼 시각에(이미 지난 시각이면 1분 안에) 실행하고, 이미 실행한 날은 다시 실행하지 않습니다.">
          <Input className="w-36" id="auto-order-confirmation-time" type="time" step={60} required value={runTime} aria-describedby="auto-order-confirmation-time-hint" onChange={event => setRunTime(event.target.value.slice(0, 5))} />
        </AdminField> : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '저장됐는지 확인' : '설정 저장'}</Button>
        {/* 비활성 버튼이 고장처럼 보이지 않게 언제 눌리는지 말한다. */}
        {!changed && !uncertain && !pending && !message ? <span className="text-xs text-muted-foreground">사용 여부나 실행 시각을 바꾸면 저장할 수 있습니다.</span> : null}
        {message ? <p className={`text-sm outline-none ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'} ref={resultRef} tabIndex={-1}>{message}</p> : null}
      </div>
    </form>
    {current.lastExclusions.length ? <div className="flex flex-col gap-2 border-t pt-4">
      <p className="text-muted-foreground">마지막 실행에서 신규주문에 남긴 주문 (최대 20건)</p>
      <ul className="flex flex-col gap-1.5">{current.lastExclusions.map(row => <li className="flex flex-wrap items-center gap-2" key={row.orderId}>
        <span className="inline-flex items-center gap-1"><OrderPreviewLink className="tabular-nums underline underline-offset-4" href={adminOrderPreviewHref(listHref, row.orderId)} label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 팝업 열기`}>주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</OrderPreviewLink>
          <OrderPreviewNewTabLink href={adminOrderDetailHrefFromBack(row.orderId, listHref)} label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 열기 (새 탭)`} /></span>{' '}
        <AdminStatusBadge tone={row.outcome === 'failed' ? 'danger' : 'warning'}>{AUTO_ORDER_CONFIRMATION_EXCLUSIONS[row.outcome]}</AdminStatusBadge>
      </li>)}</ul>
    </div> : null}
  </SalesDisclosureCard>;
}
