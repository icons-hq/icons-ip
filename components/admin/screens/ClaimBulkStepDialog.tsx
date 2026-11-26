'use client';

import { useEffect, useId, useState } from 'react';
import { bulkDecideOrderClaimsAction } from '@/app/admin/claim-actions';
import { previewOrderClaimBulkApprovalAction, previewOrderClaimBulkStepAction, runOrderClaimBulkCollectionsAction, runOrderClaimBulkRefundsAction } from '@/app/admin/claim-bulk-step-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { STOCK_DISPOSITION_LABELS } from '@/lib/admin/defective-stock';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import {
  ADMIN_CLAIM_BULK_ACTION_LABELS,
  ADMIN_CLAIM_BULK_APPROVE_GROUP_LABELS,
  ADMIN_CLAIM_BULK_AUTOMATED_NAMES,
  ADMIN_CLAIM_BULK_OUTCOME_LABELS,
  ADMIN_CLAIM_BULK_STEP_LABELS,
  adminClaimBulkCollectTargetKey,
  adminClaimBulkCollectTargetLabel,
  adminClaimBulkContinuation,
  adminClaimBulkDefectiveItemIds,
  adminClaimBulkSummary,
  type AdminClaimBulkApproveRow,
  type AdminClaimBulkCollectRow,
  type AdminClaimBulkResult,
  type AdminClaimBulkState,
  type AdminClaimBulkStep,
  type AdminClaimBulkStepPreview,
  type AdminClaimBulkRefundRow,
} from '@/lib/admin/claim-bulk';
import { adminClaimReceivedOnLabel } from '@/lib/admin/claims';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { krw } from '@/lib/format';
import { returnFeeDeductionRowNote } from '@/lib/claims/return-fee-deduction';
import { ORDER_CLAIM_TYPE_LABELS, type OrderClaimType } from '@/lib/orders/claims';
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
 * 결과는 건별로 남고, 창을 닫으면 목록 위 결과표로 넘어간다.
 *
 * 후행 트랙: 반품배송비 차감(T12a)은 환불 행의 금액·합계(서버 값)와 이 창의 금액 문구를, 불량 재고 분리(T14b)는 환불
 * 확인창의 품목별 '판매 재고 복원/불량' 선택을 이 파일의 RefundStep에 더한다.
 *
 * 취소 일괄 승인(ApproveStep)도 같은 틀이다. 승인하는 즉시 결제사에 전액 취소가 나가는 건이 있으므로 환불 확정 창처럼 건수·금액·
 * 건너뛰는 건과 이유를 서버가 읽어 먼저 보인다. 결제사로 나가는 금액과 승인만 하는 건(무통장·코페이)·결제 전 주문은 나눠 보이고, 실행은
 * 지금 그대로 목록의 일괄 결정 액션(bulkDecideOrderClaimsAction)이 건마다 단건 경로를 탄다.
 */

export interface ClaimBulkStepSession {
  /** 'approve'는 취소 일괄 승인의 확인창이다(결제사 취소를 바로 요청하므로 금액·건너뛰는 건을 먼저 보인다). */
  step: AdminClaimBulkStep | 'approve';
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
  /* 환불 확인창의 불량 선택(품목 id → 불량). 기본은 판매 재고 복원이다(QNA-035). */
  const [defective, setDefective] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inputError, setInputError] = useState('');
  const [result, setResult] = useState<AdminClaimBulkState | null>(null);
  const receivedId = useId();
  const evidenceId = useId();
  useAdminLeaveGuard({ dirty: running, message: RUNNING_LEAVE });

  useEffect(() => {
    let alive = true;
    const load = session.step === 'approve'
      ? previewOrderClaimBulkApprovalAction({ claimType, claimIds: session.claimIds })
      : previewOrderClaimBulkStepAction({ claimType, step: session.step, claimIds: session.claimIds });
    load.then(
      (state) => { if (!alive) return; if (state.preview) setPreview(state.preview); else setLoadError(state.error ?? PREVIEW_LOST); },
      () => { if (alive) setLoadError(PREVIEW_LOST); },
    );
    return () => { alive = false; };
  }, [claimType, session]);

  const title = `${session.step === 'approve' ? `${ORDER_CLAIM_TYPE_LABELS[claimType]} ${ADMIN_CLAIM_BULK_ACTION_LABELS.approve}` : ADMIN_CLAIM_BULK_STEP_LABELS[session.step]} · 선택 ${session.claimIds.length}건`;

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
    /* 품목 선택 칸이 있던 행은 선택(없으면 빈 배열 = 전부 판매 재고 복원)을 함께 보낸다. */
    const items = rows.flatMap((row) => row.blocker === null && row.amount !== null ? [{
      claimId: row.claimId, expectedAmount: row.amount,
      ...(row.items && row.items.length > 0 ? { defectiveItemIds: adminClaimBulkDefectiveItemIds(row.items, defective) } : {}),
    }] : []);
    if (items.length === 0) return;
    setRunning(true);
    const ran = await runClaimBulkInChunks(items, (pending) => runOrderClaimBulkRefundsAction({ claimType, items: pending }), setProgress);
    const excluded = rows.filter((row) => row.blocker !== null)
      .map((row) => ({ claimId: row.claimId, reference: row.reference === '확인 불가' ? null : row.reference, message: row.blocker ?? '' }));
    finish(ran, excluded);
  }

  /* 승인은 지금 그대로 목록의 일괄 결정 액션이 건마다 단건 경로를 탄다. 이 창은 확인한 건만 보내고, 시간이 모자라 남은 건은 같은 확인 아래 이어서 보낸다. */
  async function runApprove(rows: AdminClaimBulkApproveRow[]) {
    const items = rows.filter((row) => row.blocker === null).map((row) => ({ claimId: row.claimId }));
    if (items.length === 0) return;
    setRunning(true);
    const ran = await runClaimBulkInChunks(items, (pending) => {
      const data = new FormData();
      data.set('claimType', claimType);
      for (const item of pending) data.append('claimIds', item.claimId);
      data.set('decision', 'approve');
      data.set('note', '');
      return bulkDecideOrderClaimsAction({}, data);
    }, setProgress);
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
          ? `고른 요청의 출고지 입고를 한 번에 확인합니다.${claimType === 'return' ? ' 환불 기한은 실제 입고일부터 셉니다.' : ''}`
          : `결제사 취소가 겹치지 않게 한 건씩 순서대로 ${session.step === 'approve' ? '승인' : '확정'}합니다. 금액과 건너뛰는 이유는 이 창을 열 때 새로 불러온 값입니다.`}</DialogDescription>
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
          onBack={() => onClose(result)} onReceivedOn={setReceivedOn} onRun={() => { void runCollect(preview.rows); }} onToggle={(key, checked) => setUnchecked((previous) => ({ ...previous, [key]: !checked }))}
          progress={progress} receivedId={receivedId} receivedOn={receivedOn} rows={preview.rows} running={running} today={session.today} unchecked={unchecked}
        />
          : preview.step === 'approve' ? <ApproveStep onBack={() => onClose(result)} onRun={() => { void runApprove(preview.rows); }} preview={preview} progress={progress} running={running} />
            : <RefundStep defective={defective} onBack={() => onClose(result)} onDefective={(id, value) => setDefective((previous) => ({ ...previous, [id]: value }))} onRun={() => { void runRefund(preview.rows); }} progress={progress} preview={preview} running={running} />}
    </DialogContent>
  </Dialog>;
}

export function CollectStep({ evidence, evidenceId, inputError, onBack, onEvidence, onReceivedOn, onRun, onToggle, progress, receivedId, receivedOn, rows, running, today, unchecked }: {
  /** 확인창을 그만두는 [돌아가기]. 처리 중에는 눌리지 않는다. 주지 않으면 버튼을 그리지 않는다. */
  onBack?: () => void;
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
        <TableHeader><TableRow><TableHead scope="col">요청번호</TableHead><TableHead scope="col">회수 확인할 출고지</TableHead><TableHead scope="col">{ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} · 남는 출고지</TableHead></TableRow></TableHeader>
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
        <strong>{claimCount}건</strong> · 출고지 {originCount}곳 · 입고일 <span className="tabular-nums">{receivedOn ? adminClaimReceivedOnLabel(receivedOn) : '-'}</span>{excludedCount > 0 ? ` · ${ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} ${excludedCount}건` : ''}
      </p>
      {onBack ? <Button disabled={running} onClick={onBack} variant="outline">돌아가기</Button> : null}
      <Button disabled={running || originCount === 0} onClick={onRun}>{claimCount}건 회수 확인 (입고일 {receivedOn ? adminClaimReceivedOnLabel(receivedOn) : '-'})</Button>
    </DialogFooter>
  </div>;
}

export function RefundStep({ defective = {}, onBack, onDefective, onRun, preview, progress, running }: {
  /** 확인창을 그만두는 [돌아가기]. 처리 중에는 눌리지 않는다. 주지 않으면 버튼을 그리지 않는다. */
  onBack?: () => void;
  /** 품목 id → 불량 선택(QNA-035). 선택 칸이 있는 행(반품)에서만 쓴다. */
  defective?: Record<string, boolean>;
  onDefective?: (orderItemId: string, defective: boolean) => void;
  onRun: () => void;
  preview: Extract<AdminClaimBulkStepPreview, { step: 'refund' }>;
  progress: number;
  running: boolean;
}) {
  const { rows, totals } = preview;
  const excluded = rows.filter((row) => row.blocker !== null);
  /* 반품배송비 차감(ADR-0031): 환불 금액은 서버가 이미 뺀 값이다. 차감하는 행이 있을 때만 안내를 더한다. */
  const deducted = rows.some((row) => row.blocker === null && Boolean(row.deductionAmount));
  /* 결제사가 부분 취소를 받지 않으면 반품배송비를 못 빼고 전액이 환불된다. 그때 합계가 얼마까지 늘 수 있는지 서버가 준 차감액으로 말한다(부분 반품은 해당 없음). */
  const deductionExtra = rows.reduce((sum, row) => sum + (row.blocker === null && !row.partialReturn && row.amount !== null ? row.deductionAmount ?? 0 : 0), 0);
  /* 부분 반품(ADR-0047, CLM-136): 금액은 고른 상품 몫이고 그 금액만 부분 취소한다. */
  const partial = rows.some((row) => row.blocker === null && row.partialReturn);
  return <div className="flex min-w-0 flex-col gap-4" data-claim-bulk-refund="">
    <AdminNotice title="확정하면 되돌릴 수 없습니다" tone="warning">
      {ADMIN_CLAIM_BULK_AUTOMATED_NAMES} 결제는 한 건씩 순서대로 결제사에 전액 취소를 요청하고 결제사 조회로 확인합니다. 확인되면 주문 취소·재고
      복원과 환불 완료 기록이 함께 끝납니다. 입고완료 건은 환불 접수를 먼저 기록합니다. 일부가 실패해도 이미 취소된
      건은 되돌리지 않고 건별 결과로 보여 줍니다.
      {deducted ? ' 단순 변심 반품은 반품배송비를 뺀 환불 금액만 부분 취소합니다.' : null}
      {partial ? ' 부분 반품은 전액 취소가 아니라 고객이 고른 상품 몫(표의 환불 금액)만 부분 취소하고 남은 상품은 그대로 둡니다. 결제사가 부분 취소를 받지 않으면 요청이 확인 필요로 남고 상세의 "부분 반품" 칸에서 처리합니다.' : null}
    </AdminNotice>
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 px-3 py-2.5" data-claim-bulk-refund-total="">
      <p className="text-sm">처리 <strong className="tabular-nums">{totals.count}건</strong> · 환불 합계 <strong className="text-base tabular-nums">{krw(totals.amount)}</strong></p>
      {totals.byProvider.map((entry) => <p className="text-xs text-muted-foreground" key={entry.label}>{entry.label} {entry.count}건 · <span className="tabular-nums">{krw(entry.amount)}</span></p>)}
      {deductionExtra > 0 ? <p className="text-xs text-muted-foreground" data-claim-bulk-refund-full="">
        결제사가 부분 취소를 받지 않는 결제는 반품배송비를 빼지 않고 전액을 환불해 합계가 최대 <span className="tabular-nums">{krw(totals.amount + deductionExtra)}</span>까지 늘 수 있습니다. 못 뺀 반품배송비는 배송비 청구로 따로 받습니다.
      </p> : null}
      {excluded.length > 0 ? <p className="text-xs text-muted-foreground">{ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} {excluded.length}건 — 이유는 아래 표와 처리 결과에 남습니다.</p> : null}
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead scope="col">요청번호</TableHead><TableHead scope="col">결제</TableHead><TableHead className="text-right" scope="col">환불 금액</TableHead><TableHead scope="col">처리</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.flatMap((row) => [<TableRow data-claim-bulk-blocked={row.blocker ? '' : undefined} key={row.claimId}>
            <TableCell className="tabular-nums">{row.reference}</TableCell>
            <TableCell>{row.providerLabel}</TableCell>
            <TableCell className="text-right tabular-nums">{row.amount === null ? '-' : krw(row.amount)}{row.partialReturn ? <span className="block text-xs text-muted-foreground" data-claim-bulk-partial-return="">부분 반품 · 고른 상품 몫</span> : null}{row.deductionAmount ? <span className="block text-xs text-muted-foreground" data-claim-bulk-refund-deduction="">{returnFeeDeductionRowNote(row.deductionAmount)}</span> : null}</TableCell>
            <TableCell className="whitespace-normal">{row.blocker ? <span className="text-muted-foreground">{ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} · {adminClaimCopy(row.blocker)}</span> : '확정'}</TableCell>
          </TableRow>,
          ...(!row.blocker && row.items && row.items.some((item) => item.state !== 'recorded') && onDefective ? [<TableRow data-claim-bulk-stock="" key={`${row.claimId}-stock`}>
            <TableCell className="whitespace-normal bg-muted/30" colSpan={4}>
              <fieldset className="flex min-w-0 flex-col gap-1.5">
                <legend className="text-xs font-medium">품목별 재고 처리 · {row.reference}</legend>
                {row.items.filter((item) => item.state !== 'recorded').map((item) => <div className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={item.orderItemId}>
                  <Label className="min-w-0 flex-1 whitespace-normal text-xs font-normal" htmlFor={`bulk-stock-${item.orderItemId}`}>{item.name}{item.variantName ? ` · ${item.variantName}` : ''} · {item.qty}개</Label>
                  <NativeSelect className="w-full sm:w-44" disabled={running} id={`bulk-stock-${item.orderItemId}`}
                    onChange={(event) => onDefective(item.orderItemId, event.currentTarget.value === 'defective')}
                    value={(defective[item.orderItemId] ?? item.defective) ? 'defective' : 'restore'}>
                    <option value="restore">{STOCK_DISPOSITION_LABELS.restore}</option>
                    <option value="defective">{STOCK_DISPOSITION_LABELS.defective}</option>
                  </NativeSelect>
                </div>)}
              </fieldset>
            </TableCell>
          </TableRow>] : [])])}
        </TableBody>
      </Table>
    </div>
    {running ? <p className="text-sm text-muted-foreground" role="status">처리 중… 결제사 취소를 한 건씩 순서대로 확인합니다({progress}건 끝). 창을 닫지 마세요.</p> : null}
    <DialogFooter>
      {onBack ? <Button disabled={running} onClick={onBack} variant="outline">돌아가기</Button> : null}
      <Button className="h-auto min-h-8 whitespace-normal" disabled={running || totals.count === 0} onClick={onRun} variant="danger">
        {totals.count}건 환불 완료 확정 (합계 {krw(totals.amount)})
      </Button>
    </DialogFooter>
  </div>;
}

/**
 * 취소 일괄 승인 확인창의 본문. 환불 확정 확인창과 같은 모양이다 — 승인할 건수와 건너뛰는 건·이유를 서버가 읽은 값 그대로 보이고,
 * 승인 버튼에 건수와 결제사로 나가는 금액을 적는다. 승인 뒤에 일어나는 일이 결제 방식마다 달라 합계를 묶음별로 나눠 보인다:
 * 결제사로 바로 취소되는 건(금액 합계가 버튼에 적힘), 승인만 하고 환불은 따로 진행하는 건(무통장·코페이 — 이 금액은 결제사로 나가지 않음),
 * 결제 전 주문(승인하면 주문이 바로 취소). 어느 쪽이든 승인은 되돌릴 수 없다.
 */
export function ApproveStep({ onBack, onRun, preview, progress, running }: {
  /** 확인창을 그만두는 [돌아가기]. 처리 중에는 눌리지 않는다. 주지 않으면 버튼을 그리지 않는다. */
  onBack?: () => void;
  onRun: () => void;
  preview: Extract<AdminClaimBulkStepPreview, { step: 'approve' }>;
  progress: number;
  running: boolean;
}) {
  const { rows, totals } = preview;
  const skipped = rows.filter((row) => row.blocker !== null);
  return <div className="flex min-w-0 flex-col gap-4" data-claim-bulk-approve="">
    <AdminNotice title="승인하면 되돌릴 수 없습니다" tone="warning">
      {ADMIN_CLAIM_BULK_AUTOMATED_NAMES} 결제는 승인하는 즉시 결제사에 전액 취소를 요청하고, 결제사 조회로 확인되면 주문 취소·재고 복원과 환불 기록이 함께 끝납니다.
      결제 전 주문은 승인하면 결제사 취소 없이 바로 주문이 취소되고 재고가 돌아옵니다.
      무통장 입금·코페이 결제는 승인만 하고 환불은 따로 진행합니다. 한 건씩 순서대로 처리하며, 일부가 실패해도 이미 취소된 건은 되돌리지 않고 건별 결과로 보여 줍니다.
    </AdminNotice>
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 px-3 py-2.5" data-claim-bulk-approve-total="">
      <p className="text-sm">승인 <strong className="tabular-nums">{totals.count}건</strong></p>
      {totals.groups.map((group) => <div className="flex flex-col gap-0.5" data-claim-bulk-approve-group={group.kind} key={group.kind}>
        <p className="text-sm">
          {ADMIN_CLAIM_BULK_APPROVE_GROUP_LABELS[group.kind]} <strong className="tabular-nums">{group.count}건</strong>
          {group.kind !== 'order' && group.amount > 0 ? <> · <strong className={group.kind === 'provider' ? 'text-base tabular-nums' : 'font-normal tabular-nums'}>{krw(group.amount)}</strong></> : null}
        </p>
        {group.kind !== 'order' ? group.byProvider.map((entry) => <p className="text-xs text-muted-foreground" key={entry.label}>
          {entry.label} {entry.count}건{entry.amount > 0 ? <> · <span className="tabular-nums">{krw(entry.amount)}</span></> : null}
        </p>) : null}
        {group.kind === 'manual' ? <p className="text-xs text-muted-foreground">이 금액은 결제사로 나가지 않습니다. 승인한 뒤 환불을 따로 진행합니다.</p> : null}
      </div>)}
      {skipped.length > 0 ? <p className="text-xs text-muted-foreground">{ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} {skipped.length}건 — 이유는 아래 표와 처리 결과에 남습니다.</p> : null}
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead scope="col">요청번호</TableHead><TableHead scope="col">결제</TableHead><TableHead className="text-right" scope="col">취소 금액</TableHead><TableHead scope="col">처리</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => <TableRow data-claim-bulk-blocked={row.blocker ? '' : undefined} key={row.claimId}>
            <TableCell className="tabular-nums">{row.reference}</TableCell>
            <TableCell>{row.providerLabel}</TableCell>
            <TableCell className="text-right tabular-nums">{row.amount === null ? '-' : krw(row.amount)}</TableCell>
            <TableCell className="whitespace-normal">{row.blocker ? <span className="text-muted-foreground">{ADMIN_CLAIM_BULK_OUTCOME_LABELS.excluded} · {adminClaimCopy(row.blocker)}</span> : row.effect}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    {running ? <p className="text-sm text-muted-foreground" role="status">처리 중… 결제사 취소를 한 건씩 순서대로 확인합니다({progress}건 끝). 창을 닫지 마세요.</p> : null}
    <DialogFooter>
      {onBack ? <Button disabled={running} onClick={onBack} variant="outline">돌아가기</Button> : null}
      <Button className="h-auto min-h-8 whitespace-normal" disabled={running || totals.count === 0} onClick={onRun} variant="danger">
        {totals.count}건 취소 승인{totals.amount > 0 ? ` (결제사 취소 합계 ${krw(totals.amount)})` : ''}
      </Button>
    </DialogFooter>
  </div>;
}
