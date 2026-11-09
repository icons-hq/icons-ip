'use client';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { formatSalesDay } from '@/components/admin/sales/SalesConsole';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { advancePgSettlementImportAction, readPgSettlementImportAction, startPgSettlementImportAction } from '@/app/admin/pg-settlement-actions';
import { settlementFailureLabel } from '@/lib/settlements/console';
import { jobMatchesQuery, type PgSettlementJob } from '@/lib/settlements/report';
import type { SettlementMode, SettlementQuery } from '@/lib/settlements/types';
import type { PgSettlementActionResult } from '@/lib/settlements/worker.server';
import { Button } from '@/components/admin/kit/ui/button';
/* PG 자료 가져오기 카드(템플릿 룩, ADR-0028). 첫 동작만 기본 버튼이고 나머지는 보조 버튼이다. */

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
    if (!result.ok) { setMessage(result.error); setUncertain(Boolean(result.uncertain)); setRecoveryRequired(Boolean(result.recoveryRequired)); return null; }
    if (!jobMatchesQuery(result.job, query)) { setMessage('조회 기간과 수집 결과가 달라 현재 상태를 다시 확인해야 합니다.'); setUncertain(true); return null; }
    setJob(result.job); setUncertain(false); setRecoveryRequired(false);
    if (result.kind === 'failed') setMessage(settlementFailureLabel(result.job.errorCode));
    else if (result.kind === 'paused') setMessage(settlementFailureLabel(result.job.errorCode) ?? '저장된 지점에서 같은 작업을 이어서 수집할 수 있습니다.');
    else if (result.kind === 'busy') setMessage('다른 요청에서 자료를 조회하고 있습니다. 잠시 뒤 현재 상태를 확인해주세요.');
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
    } catch { if (mounted.current) { setMessage('응답을 확인하지 못했습니다. 현재 수집 상태부터 확인해주세요.'); setUncertain(true); } }
    finally { active.current = false; continuing.current = false; if (mounted.current) setRunning(false); }
  };
  const completedOrFailed = job && (job.state === 'complete' || job.state === 'failed');
  const period = `${formatSalesDay(query.startDate)} ~ ${formatSalesDay(query.endDate)}`;
  const connection = enabled ? `토스페이먼츠 ${connectedMode === 'live' ? '실거래' : '테스트'} 연결` : 'PG 정산 연결 꺼짐';
  const feedback = message ? <p role={uncertain ? 'alert' : 'status'} className={uncertain ? 'text-destructive' : 'text-foreground'}>{message}</p> : null;
  /* 연결이 꺼져 있으면 새 자료를 가져올 수 없다 — 바로 아래의 초록 '수집 완료'와 묶여 정상으로 읽히지 않도록 주의 상자 하나로 말하고, 눌리지 않는 버튼은 작게 물러난다. */
  if (!canCollect) return <section aria-label="PG 자료 가져오기" className="min-w-0 print:hidden">
    <AdminNotice tone={enabled ? 'info' : 'warning'} title={<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">{connection}<span className="font-normal text-foreground tabular-nums">{period}</span></span>}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1">{enabled ? '연결된 환경에서 자료를 가져올 수 있습니다.' : '새 자료를 가져올 수 없습니다.'} 저장된 내역 조회와 다운로드는 계속 이용할 수 있습니다.</span>
          <Button disabled size="sm" type="button" variant="outline" onClick={() => void run()}>자료 가져오기</Button>
          {job && job.state !== 'complete' ? <AdminStatusBadge tone={job.state === 'failed' ? 'danger' : 'info'}>{job.state === 'failed' ? '수집 중단' : job.scan === 2 ? '자료 대조 중' : '자료 수집 중'}</AdminStatusBadge> : null}
          {job && unfinished ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => void run(true)}>현재 상태 확인</Button> : null}
        </div>
        {feedback}
      </div>
    </AdminNotice>
  </section>;
  /* 표를 밀어내지 않게 한 줄로 그린다. */
  return <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground print:hidden" aria-label="PG 자료 가져오기">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <strong className="font-semibold">PG 자료 가져오기</strong>
      <AdminStatusBadge tone="success">{connection}</AdminStatusBadge>
      <span className="text-muted-foreground tabular-nums">{period}</span>
      {job ? <span className="flex flex-wrap items-center gap-2 tabular-nums" aria-live="polite">
        <AdminStatusBadge tone={job.state === 'complete' ? 'success' : job.state === 'failed' ? 'danger' : 'info'}>{job.state === 'complete' ? '수집 완료' : job.state === 'failed' ? '수집 중단' : job.scan === 2 ? '자료 대조 중' : '자료 수집 중'}</AdminStatusBadge>
        {job.recordCount.toLocaleString('ko-KR')}건{unfinished ? ` · ${job.nextPage}페이지 대기` : ''}
      </span> : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button disabled={running || recoveryRequired || Boolean(completedOrFailed)} size="sm" type="button" onClick={() => void run()}>
          {running ? '조회 중…' : uncertain && !job ? '같은 수집 요청 확인' : unfinished ? '이어서 수집' : '자료 가져오기'}
        </Button>
        {job ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => void run(true)}>현재 상태 확인</Button> : null}
        {recoveryRequired ? <Button size="sm" type="button" variant="outline" onClick={() => window.location.reload()}>저장된 수집 작업 다시 불러오기</Button> : null}
        {running ? <Button size="sm" type="button" variant="outline" onClick={() => { continuing.current = false; setMessage('현재 페이지를 확인한 뒤 멈춥니다.'); }}>현재 조회 후 멈춤</Button> : null}
        {completedOrFailed ? <Button size="sm" type="button" variant="outline" disabled={running} onClick={() => {
          startPayload.current = { operationId: crypto.randomUUID(), query }; setJob(null); setMessage(null); setUncertain(false);
          void run(false, true);
        }}>다시 수집</Button> : null}
      </div>
    </div>
    {feedback}
    <p className="text-xs text-muted-foreground">각 페이지를 두 번 조회해 거래 내역을 대조합니다. 창을 닫아도 저장된 지점부터 다시 시작할 수 있습니다.</p>
  </section>;
}
