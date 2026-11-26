'use client';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { formatSalesDay } from '@/components/admin/sales/SalesConsole';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { advancePgSettlementImportAction, readPgSettlementImportAction, startPgSettlementImportAction } from '@/app/admin/pg-settlement-actions';
import {
  SETTLEMENT_ACTIONS, SETTLEMENT_BUSY_MESSAGE, SETTLEMENT_PAUSED_MESSAGE, SETTLEMENT_QUERY_MISMATCH_MESSAGE, SETTLEMENT_RECOVERY_MESSAGE,
  SETTLEMENT_STOP_MESSAGE, settlementFailureLabel, settlementJobLabel, settlementUncertainMessage,
} from '@/lib/settlements/console';
import { jobMatchesQuery, type PgSettlementJob } from '@/lib/settlements/report';
import type { SettlementMode, SettlementQuery } from '@/lib/settlements/types';
import type { PgSettlementActionResult } from '@/lib/settlements/worker.server';
import { Button } from '@/components/admin/kit/ui/button';
/*
 * 결제사 자료 가져오기 카드(템플릿 룩, ADR-0028). 첫 동작만 기본 버튼이고 나머지는 보조 버튼이다.
 * 가져오기는 결제사 조회만 하고 주문·결제·환불 기록을 바꾸지 않는다. 가져올 때마다 새 기록이 하나 더 생길 뿐 전에 가져온 자료는
 * 지워지거나 덮이지 않는다(완료된 자료는 DB가 고치지 못하게 막고, 화면에는 가장 최근에 끝난 자료가 먼저 보이며 전 자료는 '내가 가져온 기록'에서 다시 본다).
 * 그래서 확인창을 두지 않는다. 버튼 이름은 `SETTLEMENT_ACTIONS`(안내·오류 문장이 같은 이름으로 가리킨다).
 */

export function PgSettlementImportControl({ query, enabled, connectedMode, initialJob, operationId }: {
  query: SettlementQuery & { mode: SettlementMode; account?: string | null }; enabled: boolean; connectedMode: SettlementMode | null;
  initialJob: PgSettlementJob | null; operationId: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const active = useRef(false), continuing = useRef(false), mounted = useRef(true);
  const startPayload = useRef({ operationId, query });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; continuing.current = false; }; }, []);
  const canCollect = enabled && connectedMode === query.mode;
  const unfinished = job?.state === 'collecting' || job?.state === 'verifying';
  const consume = (result: PgSettlementActionResult): PgSettlementJob | null => {
    if (!mounted.current) return null;
    /* 결과를 모를 때·연결이 바뀐 때의 말은 화면이 정한다 — 서버 문구가 버튼 이름을 따로 적으면 이름이 어긋난다. 말은 아래에서 작업이 있는지 보고 고른다. */
    if (!result.ok) { setMessage(result.uncertain ? null : result.recoveryRequired ? SETTLEMENT_RECOVERY_MESSAGE : result.error); setUncertain(Boolean(result.uncertain)); setRecoveryRequired(Boolean(result.recoveryRequired)); return null; }
    if (!jobMatchesQuery(result.job, query)) { setMessage(SETTLEMENT_QUERY_MISMATCH_MESSAGE); setUncertain(true); return null; }
    setJob(result.job); setUncertain(false); setRecoveryRequired(false);
    if (result.kind === 'failed') setMessage(settlementFailureLabel(result.job.errorCode));
    else if (result.kind === 'paused') setMessage(settlementFailureLabel(result.job.errorCode) ?? SETTLEMENT_PAUSED_MESSAGE);
    else if (result.kind === 'busy') setMessage(SETTLEMENT_BUSY_MESSAGE);
    else setMessage(null);
    if (result.kind === 'complete') router.refresh();
    return result.job;
  };
  const run = async (readOnly = false, fresh = false) => {
    if (active.current || (!readOnly && !canCollect)) return;
    active.current = true; continuing.current = true; setRunning(true); setMessage(null);
    try {
      let result: PgSettlementActionResult;
      if (readOnly && job) result = await readPgSettlementImportAction(job.id);
      else if (unfinished && job && !fresh) result = await advancePgSettlementImportAction(job.id);
      else result = await startPgSettlementImportAction(startPayload.current.operationId, startPayload.current.query);
      let current = consume(result);
      // Each action reads at most one provider page; navigation or the stop button
      // prevents the next step while allowing the current readback to finish.
      for (let step = 0; step < 44 && !readOnly && current && continuing.current && mounted.current
        && result.ok && (result.kind === 'created' || result.kind === 'accepted'); step++) {
        result = await advancePgSettlementImportAction(current.id);
        current = consume(result);
      }
    } catch { if (mounted.current) { setMessage(null); setUncertain(true); } }
    finally { active.current = false; continuing.current = false; if (mounted.current) setRunning(false); }
  };
  const completedOrFailed = job && (job.state === 'complete' || job.state === 'failed');
  const period = `${formatSalesDay(query.startDate)} ~ ${formatSalesDay(query.endDate)}`;
  const connection = enabled ? `토스페이먼츠 ${connectedMode === 'live' ? '실거래' : '테스트'} 연결` : '결제사 정산 연결 꺼짐';
  const jobTone = (item: PgSettlementJob): 'success' | 'danger' | 'info' => item.state === 'complete' ? 'success' : item.state === 'failed' ? 'danger' : 'info';
  /* 결과를 모를 때의 말은 작업이 이미 있는지에 따라 누를 버튼이 달라 그리는 때에 고른다. */
  const feedbackText = message ?? (uncertain ? settlementUncertainMessage(Boolean(job)) : null);
  const feedback = feedbackText ? <p role={uncertain ? 'alert' : 'status'} className={uncertain ? 'text-destructive' : 'text-foreground'}>{feedbackText}</p> : null;
  /* 연결이 꺼져 있으면 새 자료를 가져올 수 없다 — 바로 아래의 초록 '가져옴'과 묶여 정상으로 읽히지 않도록 주의 상자 하나로 말하고, 눌리지 않는 버튼은 작게 물러난다. */
  if (!canCollect) return <section aria-label="결제사 자료 가져오기" className="min-w-0 print:hidden">
    <AdminNotice tone={enabled ? 'info' : 'warning'} title={<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">{connection}<span className="font-normal text-foreground tabular-nums">{period}</span></span>}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* 꺼진 연결은 화면에서 켤 수 없다. 누구에게 말해야 하는지 적고, 눌리지 않을 버튼은 그리지 않는다. */}
          <span className="min-w-0 flex-1">{enabled ? `지금 연결은 ${connectedMode === 'live' ? '실거래' : '테스트'}용이라 ${query.mode === 'live' ? '실거래' : '테스트'} 자료는 가져올 수 없습니다.` : '새 자료는 개발 담당자가 연결을 켜야 가져올 수 있습니다.'} 가져온 자료는 계속 볼 수 있고 내려받을 수 있습니다.</span>
          {enabled ? <Button disabled size="sm" type="button" variant="outline" onClick={() => void run()}>{SETTLEMENT_ACTIONS.start}</Button> : null}
          {job && job.state !== 'complete' ? <AdminStatusBadge tone={job.state === 'failed' ? 'danger' : 'info'}>{settlementJobLabel(job)}</AdminStatusBadge> : null}
          {job && unfinished ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => void run(true)}>{SETTLEMENT_ACTIONS.check}</Button> : null}
        </div>
        {feedback}
      </div>
    </AdminNotice>
  </section>;
  /* 표를 밀어내지 않게 한 줄로 그린다. */
  return <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground print:hidden" aria-label="결제사 자료 가져오기">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <strong className="font-semibold">결제사 자료 가져오기</strong>
      <AdminStatusBadge tone="success">{connection}</AdminStatusBadge>
      <span className="text-muted-foreground tabular-nums">{period}</span>
      {job ? <span className="flex flex-wrap items-center gap-2 tabular-nums" aria-live="polite">
        <AdminStatusBadge tone={jobTone(job)}>{settlementJobLabel(job, running)}</AdminStatusBadge>
        {job.recordCount.toLocaleString('ko-KR')}건
      </span> : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button disabled={running || recoveryRequired || Boolean(completedOrFailed)} size="sm" type="button" onClick={() => void run()}>
          {running ? '진행 중…' : uncertain && !job ? SETTLEMENT_ACTIONS.confirmStarted : unfinished ? SETTLEMENT_ACTIONS.resume : SETTLEMENT_ACTIONS.start}
        </Button>
        {job ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => void run(true)}>{SETTLEMENT_ACTIONS.check}</Button> : null}
        {recoveryRequired ? <Button size="sm" type="button" variant="outline" onClick={() => window.location.reload()}>{SETTLEMENT_ACTIONS.reload}</Button> : null}
        {running ? <Button size="sm" type="button" variant="outline" onClick={() => { continuing.current = false; setMessage(SETTLEMENT_STOP_MESSAGE); }}>{SETTLEMENT_ACTIONS.stop}</Button> : null}
        {completedOrFailed ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => {
          startPayload.current = { operationId: crypto.randomUUID(), query }; setJob(null); setMessage(null); setUncertain(false);
          void run(false, true);
        }}>{SETTLEMENT_ACTIONS.again}</Button> : null}
      </div>
    </div>
    {feedback}
  </section>;
}
