'use client';

import { useEffect, useId, useState } from 'react';
import { previewOrderClaimBulkStepAction, runOrderClaimBulkCollectionsAction, runOrderClaimBulkRefundsAction } from '@/app/admin/claim-bulk-step-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import {
  ADMIN_CLAIM_BULK_STEP_LABELS,
  adminClaimBulkCollectTargetKey,
  adminClaimBulkCollectTargetLabel,
  adminClaimBulkContinuation,
  adminClaimBulkSummary,
  type AdminClaimBulkCollectRow,
  type AdminClaimBulkResult,
  type AdminClaimBulkState,
  type AdminClaimBulkStep,
  type AdminClaimBulkStepPreview,
  type AdminClaimBulkRefundRow,
} from '@/lib/admin/claim-bulk';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { krw } from '@/lib/format';
import type { OrderClaimType } from '@/lib/orders/claims';
import { ClaimBulkReshipDialog } from './ClaimBulkReshipDialog';
import { ClaimKitBulkResult } from './ClaimKitBulkResult';

/*
 * 목록 단계 일괄 처리의 확인창(1027T-033·SHEET-049·SHEET-052 · 2026-11-11 결정 "회수·환불·재출고 일괄").
 *
 * 결정 원문: "선택 건에 회수 확인·환불 완료 확정(건별 순차 결제 취소)·교환 재출고(행별 택배사·송장) 일괄, 확인창에
 * 건수·환불 합계, 무통장·가상계좌는 제외 사유 표시."
 *
 * 확인창에 보이는 건수·출고지·환불 금액·합계·제외 사유는 서버가 읽은 값이다(previewOrderClaimBulkStepAction). 이 창이
 * 고르는 것은 회수 확인의 출고지·실제 입고일·근거뿐이고, 실행은 고른 순서대로 한 건씩 단건 경로를 탄다. 목록 함수
 * 시간 안에 끝나지 않아 '미처리'로 돌아온 건은 같은 확인 아래 이어서 보낸다(한 번에 한 건도 못 하면 멈춘다).
 * 결과는 건별로 남고, 창을 닫으면 목록 아래 결과표로 넘어간다.
 *
 * 후행 트랙: 반품배송비 차감(T12a)은 환불 행의 금액·합계(서버 값)와 이 창의 금액 문구를, 불량 재고 분리(T14b)는 환불
 * 확인창의 품목별 '판매 재고 복원/불량' 선택을 이 파일의 RefundStep에 더한다.
 */

export interface ClaimBulkStepSession {
  step: AdminClaimBulkStep;
  claimIds: string[];
  /** 창을 연 때의 KST 오늘. 입고일 기본값과 상한이다. */
  today: string;
}

const PREVIEW_LOST = '확인할 내용을 불러오지 못했습니다. 창을 닫고 다시 실행해주세요.';
const RUN_LOST = '처리 결과를 받지 못했습니다. 목록을 새로고침해 각 건의 상태를 확인하세요.';
const RUNNING_LEAVE = '일괄 처리 중입니다. 이동하면 남은 건은 처리되지 않습니다. 이동할까요?';

/** 확인창 하나. 재출고는 주소 확인이 필요한 별도 창이다. */
export function ClaimBulkStepDialog({ claimType, onClose, previewHrefBase, session }: {
  claimType: OrderClaimType;
  onClose: (result: AdminClaimBulkState | null) => void;
  previewHrefBase: string;
  session: ClaimBulkStepSession;
}) {
  if (session.step === 'reship') return <ClaimBulkReshipDialog claimIds={session.claimIds} onClose={onClose} previewHrefBase={previewHrefBase} />;
  return <ClaimBulkPreviewDialog claimType={claimType} onClose={onClose} previewHrefBase={previewHrefBase} session={session} />;
}

/** 실행 결과를 고른 순서로 맞추고, 확인창에서 이미 뺀 건은 '제외'와 사유로 채운다. */
export function mergeClaimBulkResults(
  claimIds: readonly string[],
  excluded: readonly { claimId: string; reference: string | null; message: string }[],
  ran: readonly AdminClaimBulkResult[],
): AdminClaimBulkState {
  const results: AdminClaimBulkResult[] = [];
  for (const claimId of claimIds) {
    const result = ran.find((entry) => entry.claimId === claimId);
    if (result) { results.push(result); continue; }
    const skipped = excluded.find((entry) => entry.claimId === claimId);
    if (skipped) results.push({ claimId, reference: skipped.reference, outcome: 'excluded', message: skipped.message });
  }
  return { summary: adminClaimBulkSummary(results.map((result) => result.outcome)), results };
}

/**
 * 같은 확인 아래 '미처리'(시간 예산) 건을 이어서 보낸다. 오류가 나면 받은 결과까지만 돌려준다 — 이미 끝난 결제사
 * 취소를 다시 보내지 않는다. 각 실행은 서버가 건마다 사실을 다시 읽어 판정한다.
 */
export async function runClaimBulkInChunks<T extends { claimId: string }>(
  items: readonly T[],
  run: (items: T[]) => Promise<AdminClaimBulkState>,
  onProgress?: (done: number) => void,
): Promise<{ results: AdminClaimBulkResult[]; error: string | null }> {
  const results: AdminClaimBulkResult[] = [];
  let pending = [...items];
  while (pending.length > 0) {
    let state: AdminClaimBulkState;
    try {
      state = await run(pending);
    } catch {
      return { results, error: RUN_LOST };
    }
    if (state.error || !state.results) return { results, error: state.error ?? RUN_LOST };
    const next = adminClaimBulkContinuation(state.results);
    results.push(...state.results.filter((result) => result.outcome !== 'skipped'));
    onProgress?.(results.length);
    if (!next.continue) {
      results.push(...next.skipped);
      break;
    }
    const skippedIds = new Set(next.skipped.map((result) => result.claimId));
    pending = pending.filter((item) => skippedIds.has(item.claimId));
  }
  return { results, error: null };
}


function ClaimBulkPreviewDialog({ claimType, onClose, previewHrefBase, session }: {
  claimType: OrderClaimType;
  onClose: (result: AdminClaimBulkState | null) => void;
  previewHrefBase: string;
  session: ClaimBulkStepSession;
}) {
  const [preview, setPreview] = useState<AdminClaimBulkStepPreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [receivedOn, setReceivedOn] = useState(session.today);
  const [evidence, setEvidence] = useState('');
  /* 확인창에서 뺀 출고지(요청:배송 건). 기본은 남은 출고지 전부를 확인한다. */
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inputError, setInputError] = useState('');
  const [result, setResult] = useState<AdminClaimBulkState | null>(null);
  const receivedId = useId();
  const evidenceId = useId();
  useAdminLeaveGuard({ dirty: running, message: RUNNING_LEAVE });

  useEffect(() => {
    let alive = true;
    previewOrderClaimBulkStepAction({ claimType, step: session.step, claimIds: session.claimIds }).then(
      (state) => { if (!alive) return; if (state.preview) setPreview(state.preview); else setLoadError(state.error ?? PREVIEW_LOST); },
      () => { if (alive) setLoadError(PREVIEW_LOST); },
    );
    return () => { alive = false; };
  }, [claimType, session]);

  const title = `${ADMIN_CLAIM_BULK_STEP_LABELS[session.step]} · 선택 ${session.claimIds.length}건`;

  async function runCollect(rows: AdminClaimBulkCollectRow[]) {
    const items = rows.filter((row) => row.blocker === null)
      .map((row) => ({ row, targets: row.targets.filter((target) => !unchecked[adminClaimBulkCollectTargetKey(row.claimId, target)]) }))
      .filter((entry) => entry.targets.length > 0)
      .map(({ row, targets }) => ({ claimId: row.claimId,
        shipmentIds: targets.flatMap((target) => target.shipmentId && !target.bundleId ? [target.shipmentId] : []),
        bundleIds: targets.flatMap((target) => target.bundleId ? [target.bundleId] : []) }));
    if (items.length === 0) { setInputError('회수 확인할 출고지를 하나 이상 골라주세요.'); return; }
    if (!receivedOn || receivedOn > session.today) { setInputError('실제 입고일은 오늘이나 그 이전 날짜로 입력해주세요.'); return; }
    if (!evidence.trim() || evidence.trim().length > 500) { setInputError('회수 확인 근거를 500자 이내로 입력해주세요.'); return; }
    setInputError('');
    setRunning(true);
    const ran = await runClaimBulkInChunks(items, (pending) => runOrderClaimBulkCollectionsAction({ claimType, receivedOn, evidence: evidence.trim(), items: pending }), setProgress);
    const excluded = rows.filter((row) => row.blocker !== null || !items.some((item) => item.claimId === row.claimId))
      .map((row) => ({ claimId: row.claimId, reference: row.reference === '확인 불가' ? null : row.reference, message: row.blocker ?? '확인창에서 출고지를 모두 뺐습니다.' }));
    finish(ran, excluded);
  }

  async function runRefund(rows: AdminClaimBulkRefundRow[]) {
    const items = rows.flatMap((row) => row.blocker === null && row.amount !== null ? [{ claimId: row.claimId, expectedAmount: row.amount }] : []);
    if (items.length === 0) return;
    setRunning(true);
    const ran = await runClaimBulkInChunks(items, (pending) => runOrderClaimBulkRefundsAction({ claimType, items: pending }), setProgress);
    const excluded = rows.filter((row) => row.blocker !== null)
      .map((row) => ({ claimId: row.claimId, reference: row.reference === '확인 불가' ? null : row.reference, message: row.blocker ?? '' }));
    finish(ran, excluded);
  }

  function finish(ran: { results: AdminClaimBulkResult[]; error: string | null }, excluded: { claimId: string; reference: string | null; message: string }[]) {
    const merged = mergeClaimBulkResults(session.claimIds, excluded, ran.results);
    setResult(ran.error ? { ...merged, error: ran.error } : merged);
    setRunning(false);
  }

  return <Dialog
    disablePointerDismissal
    onOpenChange={(open) => { if (!open && !running) onClose(result); }}
    open
  >
    <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-3xl" data-claim-bulk-step={session.step} showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{session.step === 'collect'
          ? '고른 요청의 출고지 입고를 한 번에 확인합니다. 환급 기한은 실제 입고일부터 셉니다.'
          : '결제사 취소가 겹치지 않게 한 건씩 순서대로 확정합니다. 금액과 제외 사유는 서버가 지금 다시 읽은 값입니다.'}</DialogDescription>
      </DialogHeader>
      {result ? <>
        {result.error ? <AdminNotice role="alert" tone="danger">{adminClaimCopy(result.error)}</AdminNotice> : null}
        <ClaimKitBulkResult previewHrefBase={previewHrefBase} state={result} />
        <DialogFooter><Button onClick={() => onClose(result)}>닫기</Button></DialogFooter>
      </> : loadError ? <>
        <AdminNotice role="alert" tone="danger">{adminClaimCopy(loadError)}</AdminNotice>
        <DialogFooter><Button onClick={() => onClose(null)} variant="outline">닫기</Button></DialogFooter>
      </> : !preview ? <p className="text-muted-foreground" role="status">확인할 내용을 불러오는 중입니다…</p>
        : preview.step === 'collect' ? <CollectStep
          evidence={evidence} evidenceId={evidenceId} inputError={inputError} onEvidence={setEvidence}
          onReceivedOn={setReceivedOn} onRun={() => { void runCollect(preview.rows); }} onToggle={(key, checked) => setUnchecked((previous) => ({ ...previous, [key]: !checked }))}
          progress={progress} receivedId={receivedId} receivedOn={receivedOn} rows={preview.rows} running={running} today={session.today} unchecked={unchecked}
        />
          : <RefundStep onRun={() => { void runRefund(preview.rows); }} progress={progress} preview={preview} running={running} />}
    </DialogContent>
  </Dialog>;
}

export function CollectStep({ evidence, evidenceId, inputError, onEvidence, onReceivedOn, onRun, onToggle, progress, receivedId, receivedOn, rows, running, today, unchecked }: {
  evidence: string;
  evidenceId: string;
  inputError: string;
  onEvidence: (value: string) => void;
  onReceivedOn: (value: string) => void;
  onRun: () => void;
  onToggle: (key: string, checked: boolean) => void;
  progress: number;
  receivedId: string;
  receivedOn: string;
  rows: AdminClaimBulkCollectRow[];
  running: boolean;
  today: string;
  unchecked: Record<string, boolean>;
}) {
  const ready = rows.filter((row) => row.blocker === null);
  const chosen = ready.map((row) => row.targets.filter((target) => !unchecked[adminClaimBulkCollectTargetKey(row.claimId, target)]).length);
  const claimCount = chosen.filter((count) => count > 0).length;
  const originCount = chosen.reduce((sum, count) => sum + count, 0);
  const excludedCount = rows.length - ready.length;
  return <div className="flex min-w-0 flex-col gap-4" data-claim-bulk-collect="">
    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={receivedId}>실제 입고일</Label>
        <Input disabled={running} id={receivedId} max={today} onChange={(event) => onReceivedOn(event.target.value)} required type="date" value={receivedOn} />
        <p className="text-xs text-muted-foreground">창고에 실제로 도착한 날입니다. 기본은 오늘이고 미래 날짜는 고를 수 없습니다.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={evidenceId}>회수 확인 근거</Label>
        <Textarea disabled={running} id={evidenceId} maxLength={500} onChange={(event) => onEvidence(event.target.value)} placeholder="창고 회신 번호와 반송 상품·수량 대조 결과" required rows={3} value={evidence} />
        <p className="text-xs text-muted-foreground">고른 출고지 모두에 같은 근거와 입고일로 남습니다.</p>
      </div>
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead scope="col">요청번호</TableHead><TableHead scope="col">회수 확인할 출고지</TableHead><TableHead scope="col">제외 · 남는 출고지</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => <TableRow data-claim-bulk-blocked={row.blocker ? '' : undefined} key={row.claimId}>
            <TableCell className="tabular-nums">{row.reference}</TableCell>
            <TableCell className="whitespace-normal">{row.blocker ? <span className="text-muted-foreground">처리하지 않음</span>
              : <div className="flex flex-col gap-1.5">{row.targets.map((target) => {
                const key = adminClaimBulkCollectTargetKey(row.claimId, target);
                return <label className="flex items-center gap-2" key={key}>
                  <Checkbox checked={!unchecked[key]} disabled={running} onCheckedChange={(value) => onToggle(key, !!value)} />
                  <span>{adminClaimBulkCollectTargetLabel(target)}</span>
                </label>;
              })}</div>}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{row.blocker
              ? adminClaimCopy(row.blocker)
              : row.skipped.length > 0 ? row.skipped.map((entry) => `${entry.originName}: ${entry.reason}`).join(' ') : '-'}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    {inputError ? <p className="text-sm text-destructive" role="alert">{inputError}</p> : null}
    {running ? <p className="text-sm text-muted-foreground" role="status">처리 중… 한 건씩 순서대로 확인합니다({progress}건 끝). 창을 닫지 마세요.</p> : null}
    <DialogFooter>
      <p className="mr-auto self-center text-sm" data-claim-bulk-summary="">
        <strong>{claimCount}건</strong> · 출고지 {originCount}곳 · 입고일 <span className="tabular-nums">{receivedOn || '-'}</span>{excludedCount > 0 ? ` · 제외 ${excludedCount}건` : ''}
      </p>
      <Button disabled={running || originCount === 0} onClick={onRun}>{claimCount}건 회수 확인 (입고일 {receivedOn || '-'})</Button>
    </DialogFooter>
  </div>;
}

export function RefundStep({ onRun, preview, progress, running }: {
  onRun: () => void;
  preview: Extract<AdminClaimBulkStepPreview, { step: 'refund' }>;
  progress: number;
  running: boolean;
}) {
  const { rows, totals } = preview;
  const excluded = rows.filter((row) => row.blocker !== null);
  return <div className="flex min-w-0 flex-col gap-4" data-claim-bulk-refund="">
    <AdminNotice title="확정하면 되돌릴 수 없습니다" tone="warning">
      토스·나이스페이 결제는 한 건씩 순서대로 결제사 전액 취소를 발행하고 결제사 조회로 확인합니다. 확인되면 주문 취소·재고
      복원·카드팩 회수와 환불 완료 기록이 함께 끝납니다. 입고완료 건은 환불 접수를 먼저 기록합니다. 일부가 실패해도 이미 취소된
      건은 되돌리지 않고 건별 결과로 보여 줍니다.
    </AdminNotice>
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 px-3 py-2.5" data-claim-bulk-refund-total="">
      <p className="text-sm">처리 <strong className="tabular-nums">{totals.count}건</strong> · 환불 합계 <strong className="text-base tabular-nums">{krw(totals.amount)}</strong></p>
      {totals.byProvider.map((entry) => <p className="text-xs text-muted-foreground" key={entry.label}>{entry.label} {entry.count}건 · <span className="tabular-nums">{krw(entry.amount)}</span></p>)}
      {excluded.length > 0 ? <p className="text-xs text-muted-foreground">제외 {excluded.length}건 — 사유는 아래 표와 처리 결과에 남습니다.</p> : null}
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead scope="col">요청번호</TableHead><TableHead scope="col">결제</TableHead><TableHead className="text-right" scope="col">환불 금액</TableHead><TableHead scope="col">처리</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => <TableRow data-claim-bulk-blocked={row.blocker ? '' : undefined} key={row.claimId}>
            <TableCell className="tabular-nums">{row.reference}</TableCell>
            <TableCell>{row.providerLabel}</TableCell>
            <TableCell className="text-right tabular-nums">{row.amount === null ? '-' : krw(row.amount)}</TableCell>
            <TableCell className="whitespace-normal">{row.blocker ? <span className="text-muted-foreground">제외 · {adminClaimCopy(row.blocker)}</span> : '확정'}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    {running ? <p className="text-sm text-muted-foreground" role="status">처리 중… 결제사 취소를 한 건씩 순서대로 확인합니다({progress}건 끝). 창을 닫지 마세요.</p> : null}
    <DialogFooter>
      <Button className="h-auto min-h-8 whitespace-normal" disabled={running || totals.count === 0} onClick={onRun} variant="danger">
        {totals.count}건 환불 완료 확정 (합계 {krw(totals.amount)})
      </Button>
    </DialogFooter>
  </div>;
}
