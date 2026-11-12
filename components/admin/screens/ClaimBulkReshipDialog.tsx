'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadOrderClaimBulkReshipmentsAction } from '@/app/admin/claim-bulk-step-actions';
import { claimContactJournalKey } from '@/components/admin/ClaimContactOperations';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import {
  ADMIN_CLAIM_BULK_RESHIP_LIMIT,
  adminClaimBulkReshipRowError,
  adminClaimBulkSummary,
  type AdminClaimBulkResult,
  type AdminClaimBulkReshipClaim,
  type AdminClaimBulkReshipLoad,
  type AdminClaimBulkReshipRow,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { fetchClaimContactContext, readOrSealClaimContactOperation, recordClaimReshipmentV2 } from '@/lib/claim-contact/client';
import {
  normalizeClaimContactReshipmentRequest,
  parseClaimContactJournal,
  type Address,
  type ClaimContactJournal,
  type OperationReceipt,
} from '@/lib/claim-contact/contracts';
import { ClaimKitBulkResult } from './ClaimKitBulkResult';

/*
 * 교환 재출고 일괄(SHEET-052 · 2026-11-11 결정 "교환 재출고(행별 택배사·송장)").
 *
 * (요청 × 배송 건) 한 줄마다 택배사·운송장·재출고 옵션을 받아, 상세의 [재출고 등록]과 같은 연락처 경로
 * (/api/admin/claim-contact/*)로 배송 건 단위 재출고 service RPC를 한 줄씩 부른다(ADR-0041). 최종 주소 확인(10분 결속)은
 * 요청마다 이 창에서 보여 주고 한 번에 확인한다. 같은 요청의 다음 배송 건은 앞 재출고로 요청 버전이 바뀌므로 최종 주소를
 * 다시 받아, 처음 확인한 주소와 같을 때만 이어서 보낸다(첫 재출고 뒤 재배송지 정정은 막혀 있다). 확인한 지 10분이 지나면
 * 보내지 않는다.
 *
 * 요청번호(작업 id)는 상세 화면과 같은 탭 저장소 키에 남긴다. 응답을 잃으면 같은 작업 id로 결과를 읽고, 저장되지 않았으면
 * 그 작업을 종료(seal)한다 — 늦게 도착한 요청이 다른 재출고와 겹치지 않는다. 결과를 끝내 읽지 못하면 요청번호를 남겨
 * 두고, 그 요청의 상세가 [저장 결과 확인]을 띄운다. 회수 생략(하자·오배송, 근거 사진)은 상세에서만 한다.
 *
 * 주소는 개인정보라 화면 상태에만 두고, 탭을 가리거나 처리가 끝나면 지운다(상세 화면과 같은 규칙).
 */

type ReadyContext = {
  status: 'ready';
  address: Address;
  signedContext: string;
  expiresAt: string;
  claimRevision: number;
  claimType: 'return' | 'exchange';
};
type ContextState = { status: 'loading' } | ReadyContext | { status: 'unavailable'; message: string };
type RowDraft = { carrier: string; trackingNumber: string; items: Record<string, string> };

const LOAD_LOST = '재출고할 요청을 불러오지 못했습니다. 창을 닫고 다시 실행해주세요.';
const EXPIRED = '최종 주소를 확인한 지 10분이 지났습니다. 주소를 다시 불러와 확인해주세요.';
const ADDRESS_CHANGED = '최종 주소가 처음 확인한 것과 달라 보내지 않았습니다. 요청 상세에서 다시 확인해주세요.';
const PREVIOUS_FAILED = '앞 출고지의 재출고가 끝나지 않아 보내지 않았습니다. 요청 상세에서 확인해주세요.';
const OUTCOME_UNKNOWN = '처리 결과를 확인하지 못했습니다. 요청 상세의 [저장 결과 확인]으로 결과를 확인해주세요.';
const AUTH_CHANGED = '로그인 상태가 바뀌어 남은 줄을 보내지 않았습니다. 다시 로그인한 뒤 상세에서 확인해주세요.';
const NOT_CONFIRMED = '최종 주소를 확인하지 않은 요청입니다.';
const PENDING_OPERATION = '결과를 확인하지 않은 연락처·재출고 작업이 남아 있어 보내지 않았습니다. 요청 상세에서 저장 결과를 먼저 확인해주세요.';
const RUNNING_LEAVE = '재출고를 등록하는 중입니다. 이동하면 남은 줄은 보내지 않습니다. 이동할까요?';
const PRIVATE_LEAVE = '불러온 최종 주소는 보관하지 않습니다. 이동할까요?';

export function reshipRowKey(claimId: string, shipmentId: string | null) {
  return `${claimId}:${shipmentId ?? 'order'}`;
}

function originLabel(row: AdminClaimBulkReshipRow) {
  return row.originName ?? '주문 전체';
}

/** 다음 배송 건을 보내기 전에 다시 받은 최종 주소가 처음 확인한 주소와 같은가. */
export function sameClaimContactAddress(a: Address, b: Address) {
  return a.recipientName === b.recipientName && a.phone === b.phone && a.postalCode.trim() === b.postalCode.trim()
    && a.address1.trim() === b.address1.trim() && a.address2 === b.address2;
}

function receiptMatches(receipt: OperationReceipt, journal: ClaimContactJournal) {
  return receipt.state === 'saved' && receipt.operationId === journal.operationId && receipt.actorId === journal.actorId
    && receipt.sessionId === journal.sessionId && receipt.orderId === journal.orderId && receipt.claimId === journal.claimId
    && receipt.command === 'reshipment' && receipt.target === 'reshipment'
    && receipt.expectedClaimType === journal.expectedClaimType && receipt.expectedClaimRevision === journal.expectedClaimRevision;
}

function initialDrafts(load: Extract<AdminClaimBulkReshipLoad, { actorId: string }>): Record<string, RowDraft> {
  const carrier = load.carriers[0]?.code ?? '';
  return Object.fromEntries(load.claims.flatMap((claim) => claim.rows.map((row) => [reshipRowKey(claim.claimId, row.shipmentId), {
    carrier, trackingNumber: '', items: Object.fromEntries(row.items.map((item) => [item.orderItemId, item.currentVariantId])),
  }])));
}

/** 불러올 때 이미 뺀 요청·출고지를 결과표의 '제외'로 남긴다. */
function excludedResults(load: Extract<AdminClaimBulkReshipLoad, { actorId: string }>): AdminClaimBulkResult[] {
  return [
    ...load.excluded.map((entry) => ({ claimId: entry.claimId, reference: entry.reference, outcome: 'excluded' as const, message: entry.reason })),
    ...load.claims.flatMap((claim) => claim.skipped.map((entry) => ({
      claimId: claim.claimId, reference: claim.reference, scope: entry.originName, outcome: 'excluded' as const, message: entry.reason,
    }))),
  ];
}

export function ClaimBulkReshipDialog({ claimIds, onClose, previewHrefBase }: {
  claimIds: string[];
  onClose: (result: AdminClaimBulkState | null) => void;
  previewHrefBase: string;
}) {
  const [load, setLoad] = useState<AdminClaimBulkReshipLoad | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AdminClaimBulkState | null>(null);

  useEffect(() => {
    let alive = true;
    loadOrderClaimBulkReshipmentsAction({ claimType: 'exchange', step: 'reship', claimIds }).then(
      (value) => { if (alive) setLoad(value); },
      () => { if (alive) setLoad({ error: LOAD_LOST }); },
    );
    return () => { alive = false; };
  }, [claimIds]);

  return <Dialog disablePointerDismissal onOpenChange={(open) => { if (!open && !running) onClose(result); }} open>
    <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-4xl" data-claim-bulk-step="reship" showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle>선택 건 재출고 · 선택 {claimIds.length}건</DialogTitle>
        <DialogDescription>
          회수를 확인한 출고지마다 택배사·운송장을 넣고 한 번에 등록합니다. 최종 주소는 요청마다 이 창에서 확인하며, 한 번에
          {` ${ADMIN_CLAIM_BULK_RESHIP_LIMIT}`}건까지 엽니다.
        </DialogDescription>
      </DialogHeader>
      {result ? <>
        {result.error ? <AdminNotice role="alert" tone="danger">{adminClaimCopy(result.error)}</AdminNotice> : null}
        <ClaimKitBulkResult previewHrefBase={previewHrefBase} state={result} />
        <DialogFooter><Button onClick={() => onClose(result)}>닫기</Button></DialogFooter>
      </> : !load ? <p className="text-muted-foreground" role="status">재출고할 요청을 불러오는 중입니다…</p>
        : load.error !== undefined ? <>
          <AdminNotice role="alert" tone="danger">{adminClaimCopy(load.error)}</AdminNotice>
          <DialogFooter><Button onClick={() => onClose(null)} variant="outline">닫기</Button></DialogFooter>
        </>
          : load.claims.length === 0 ? <>
            <AdminNotice tone="info" title="재출고할 수 있는 요청이 없습니다">회수를 확인한 출고지가 있는 교환만 재출고합니다. 사유는 아래 결과표에 남깁니다.</AdminNotice>
            <ClaimKitBulkResult previewHrefBase={previewHrefBase} state={{ summary: adminClaimBulkSummary(excludedResults(load).map((entry) => entry.outcome)), results: excludedResults(load) }} />
            <DialogFooter><Button onClick={() => onClose({ summary: adminClaimBulkSummary(excludedResults(load).map((entry) => entry.outcome)), results: excludedResults(load) })} variant="outline">닫기</Button></DialogFooter>
          </>
            : <ClaimContactSession actorId={load.actorId} pendingMessage="최종 주소를 열기 위해 로그인 상태를 확인하고 있습니다.">
              {(identity, scope) => <ReshipTable identity={identity} load={load} onDone={setResult} onRunning={setRunning} scope={scope} />}
            </ClaimContactSession>}
    </DialogContent>
  </Dialog>;
}

function ReshipTable({ identity, load, onDone, onRunning, scope }: {
  identity: ClaimContactIdentity;
  load: Extract<AdminClaimBulkReshipLoad, { actorId: string }>;
  onDone: (result: AdminClaimBulkState) => void;
  onRunning: (running: boolean) => void;
  scope: ClaimContactScope;
}) {
  const router = useRouter();
  const [contexts, setContexts] = useState<Record<string, ContextState>>({});
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => initialDrafts(load));
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [dispatchConfirmed, setDispatchConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running'>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);
  const hasPrivate = Object.values(contexts).some((context) => context.status === 'ready');
  useAdminLeaveGuard({ dirty: phase === 'running' || hasPrivate, message: phase === 'running' ? RUNNING_LEAVE : PRIVATE_LEAVE });

  useEffect(() => {
    alive.current = true;
    /* 탭을 가리면 불러온 주소와 주소 확인 체크를 지운다(상세의 연락처 처리와 같은 규칙). 운송장 입력은 남긴다. */
    const hide = () => {
      if (document.visibilityState === 'visible') return;
      setContexts((current) => (Object.values(current).some((context) => context.status === 'ready') ? {} : current));
      setDestinationConfirmed(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; document.removeEventListener('visibilitychange', hide); };
  }, []);

  /* 확인 시간(10분)이 지난 주소는 지운다. 가장 먼저 끝나는 시각에 한 번 깨어난다. */
  const nextExpiry = Object.values(contexts).reduce<number | null>((earliest, context) => {
    if (context.status !== 'ready') return earliest;
    const at = Date.parse(context.expiresAt);
    return earliest === null || at < earliest ? at : earliest;
  }, null);
  useEffect(() => {
    if (nextExpiry === null || phase === 'running') return;
    const timer = window.setTimeout(() => {
      setContexts((current) => Object.fromEntries(Object.entries(current).map(([claimId, context]) => [claimId,
        context.status === 'ready' && Date.parse(context.expiresAt) <= Date.now() ? { status: 'unavailable', message: EXPIRED } : context])));
      setDestinationConfirmed(false);
    }, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextExpiry, phase]);

  async function loadAddresses() {
    const ticket = scope.capture();
    if (!ticket || phase !== 'idle') return;
    setPhase('loading'); setError(''); setDestinationConfirmed(false);
    setContexts(Object.fromEntries(load.claims.map((claim) => [claim.claimId, { status: 'loading' } as const])));
    for (const claim of load.claims) {
      let next: ContextState;
      try {
        const response = await fetchClaimContactContext({ requestId: crypto.randomUUID(), orderId: claim.orderId, claimId: claim.claimId, target: 'reshipment', command: 'reshipment' }, { expectedIdentity: identity });
        if ('code' in response) next = { status: 'unavailable', message: response.message };
        else if (!response.allowed || !response.address || !response.signedContext || !response.expiresAt) {
          next = { status: 'unavailable', message: '지금은 이 요청의 재출고를 등록할 수 없습니다. 요청 상세에서 확인해주세요.' };
        } else {
          next = { status: 'ready', address: response.address, signedContext: response.signedContext, expiresAt: response.expiresAt,
            claimRevision: response.claimRevision, claimType: response.claimType };
        }
      } catch {
        next = { status: 'unavailable', message: '최종 주소를 읽지 못했습니다. 다시 불러와 주세요.' };
      }
      if (!alive.current || !scope.canApply(ticket)) { setContexts({}); setPhase('idle'); return; }
      setContexts((current) => ({ ...current, [claim.claimId]: next }));
    }
    setPhase('idle');
  }

  function patch(key: string, value: Partial<RowDraft>) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...value } }));
  }

  const readyClaims = load.claims.filter((claim) => contexts[claim.claimId]?.status === 'ready');
  const readyRows = readyClaims.reduce((sum, claim) => sum + claim.rows.length, 0);

  async function register() {
    if (phase !== 'idle') return;
    for (const claim of readyClaims) {
      for (const row of claim.rows) {
        const draft = drafts[reshipRowKey(claim.claimId, row.shipmentId)];
        const problem = adminClaimBulkReshipRowError({ carrier: draft.carrier, trackingNumber: draft.trackingNumber, items: row.items.map((item) => ({ variantId: draft.items[item.orderItemId] ?? '' })) });
        if (problem) { setError(`${claim.reference} ${originLabel(row)}: ${problem}`); return; }
      }
    }
    if (readyRows === 0) { setError('최종 주소를 불러온 요청이 없습니다. [최종 주소 불러오기]를 먼저 눌러주세요.'); return; }
    if (!destinationConfirmed || !dispatchConfirmed) { setError('최종 주소와 실제 발송 정보를 확인했다고 체크해주세요.'); return; }
    const ticket = scope.capture();
    if (!ticket) return;
    setError(''); setPhase('running'); onRunning(true); setProgress(0);
    const results: AdminClaimBulkResult[] = [];
    let authLost = false;
    for (const claim of load.claims) {
      const context = contexts[claim.claimId];
      const fail = (row: AdminClaimBulkReshipRow, message: string, outcome: AdminClaimBulkResult['outcome'] = 'failed') => {
        results.push({ claimId: claim.claimId, reference: claim.reference, scope: originLabel(row), outcome, message });
      };
      if (authLost) { claim.rows.forEach((row) => fail(row, AUTH_CHANGED)); continue; }
      if (context?.status !== 'ready') { claim.rows.forEach((row) => fail(row, context?.status === 'unavailable' ? context.message : NOT_CONFIRMED, 'excluded')); continue; }
      const outcome = await registerClaim(claim, context, ticket, fail, (row, message) => {
        results.push({ claimId: claim.claimId, reference: claim.reference, scope: originLabel(row), outcome: 'done', message });
        setProgress((count) => count + 1);
      });
      if (outcome === 'auth_lost') authLost = true;
      if (!alive.current) return;
    }
    if (!alive.current) return;
    /* 주소는 처리가 끝나면 바로 지운다. 결과표에는 요청번호·출고지·결과만 남는다. */
    setContexts({}); setDestinationConfirmed(false); setDispatchConfirmed(false);
    const all = [...results, ...excludedResults(load)];
    const ordered = load.claims.flatMap((claim) => all.filter((entry) => entry.claimId === claim.claimId))
      .concat(all.filter((entry) => !load.claims.some((claim) => claim.claimId === entry.claimId)));
    onRunning(false);
    setPhase('idle');
    onDone({ summary: adminClaimBulkSummary(ordered.map((entry) => entry.outcome)), results: ordered });
    router.refresh();
  }

  /** 한 요청의 배송 건을 순서대로 보낸다. 실패하면 그 요청의 남은 배송 건은 보내지 않는다. */
  async function registerClaim(
    claim: AdminClaimBulkReshipClaim,
    context: ReadyContext,
    ticket: NonNullable<ReturnType<ClaimContactScope['capture']>>,
    fail: (row: AdminClaimBulkReshipRow, message: string) => void,
    succeed: (row: AdminClaimBulkReshipRow, message: string) => void,
  ): Promise<'ok' | 'stopped' | 'auth_lost'> {
    let signedContext = context.signedContext;
    let claimRevision = context.claimRevision;
    let claimType = context.claimType;
    let stop: string | null = null;
    /* 상세에서 결과를 아직 확인하지 않은 연락처 작업이 있으면 그 요청은 보내지 않는다(요청번호를 덮어쓰지 않는다). */
    let pendingJournal: string | null = null;
    try { pendingJournal = sessionStorage.getItem(claimContactJournalKey(identity, claim.orderId, claim.claimId)); }
    catch { pendingJournal = 'unavailable'; }
    if (pendingJournal !== null) stop = PENDING_OPERATION;
    for (const [index, row] of claim.rows.entries()) {
      if (stop) { fail(row, stop); continue; }
      if (Date.parse(context.expiresAt) <= Date.now()) { stop = EXPIRED; fail(row, EXPIRED); continue; }
      if (index > 0) {
        /* 앞 재출고로 요청 버전이 바뀌었다. 최종 주소를 다시 받아 처음 확인한 주소와 같을 때만 이어서 보낸다. */
        const fresh = await fetchClaimContactContext({ requestId: crypto.randomUUID(), orderId: claim.orderId, claimId: claim.claimId, target: 'reshipment', command: 'reshipment' }, { expectedIdentity: identity }).catch(() => null);
        if (!scope.canApply(ticket)) { fail(row, AUTH_CHANGED); claim.rows.slice(index + 1).forEach((rest) => fail(rest, AUTH_CHANGED)); return 'auth_lost'; }
        if (!fresh || 'code' in fresh) { stop = fresh && 'code' in fresh ? fresh.message : PREVIOUS_FAILED; fail(row, stop); continue; }
        if (!fresh.allowed || !fresh.address || !fresh.signedContext || !sameClaimContactAddress(fresh.address, context.address)) { stop = ADDRESS_CHANGED; fail(row, stop); continue; }
        signedContext = fresh.signedContext; claimRevision = fresh.claimRevision; claimType = fresh.claimType;
      }
      const draft = drafts[reshipRowKey(claim.claimId, row.shipmentId)];
      const operationId = crypto.randomUUID();
      const request = normalizeClaimContactReshipmentRequest({
        requestId: crypto.randomUUID(), orderId: claim.orderId, claimId: claim.claimId, operationId, signedContext,
        shipmentId: row.shipmentId, carrier: draft.carrier, trackingNumber: draft.trackingNumber,
        items: row.items.map((item) => ({ orderItemId: item.orderItemId, variantId: draft.items[item.orderItemId] })),
        collectionWaiver: null, destinationConfirmed: true, dispatchConfirmed: true,
      });
      const journal = parseClaimContactJournal({ operationId, orderId: claim.orderId, claimId: claim.claimId, command: 'reshipment', target: 'reshipment',
        expectedClaimType: claimType, expectedClaimRevision: claimRevision, actorId: identity.actorId, sessionId: identity.sessionId, startedAt: new Date().toISOString() });
      if (!request || !journal) { stop = PREVIOUS_FAILED; fail(row, '재출고 정보를 확인하지 못했습니다. 택배사·운송장·상품을 다시 확인해주세요.'); continue; }
      const journalKey = claimContactJournalKey(identity, claim.orderId, claim.claimId);
      try { sessionStorage.setItem(journalKey, JSON.stringify(journal)); }
      catch { stop = PREVIOUS_FAILED; fail(row, '요청번호를 보관할 수 없어 보내지 않았습니다. 브라우저 저장소를 확인해주세요.'); continue; }
      const forget = () => { try { sessionStorage.removeItem(journalKey); } catch { /* 남은 요청번호는 상세가 결과를 읽어 정리한다. */ } };

      const response = await recordClaimReshipmentV2(request, { expectedIdentity: identity }).catch(() => null);
      if (!scope.canApply(ticket)) { fail(row, OUTCOME_UNKNOWN); claim.rows.slice(index + 1).forEach((rest) => fail(rest, AUTH_CHANGED)); return 'auth_lost'; }
      if (response && !('code' in response) && response.receipt && receiptMatches(response.receipt, journal)) {
        forget();
        succeed(row, `재출고를 등록했습니다(${draft.trackingNumber.trim().toUpperCase()}).`);
        continue;
      }
      /* 실패·불확실: 같은 작업 id로 결과를 읽고, 저장되지 않았으면 그 작업을 종료한다. 늦게 도착한 요청이 다시 기록되지 않는다. */
      const settled = await readOrSealClaimContactOperation({ requestId: crypto.randomUUID(), sealIfAbsent: true, orderId: claim.orderId, claimId: claim.claimId,
        operationId, command: 'reshipment', target: 'reshipment', expectedClaimType: claimType, expectedClaimRevision: claimRevision }, { expectedIdentity: identity }).catch(() => null);
      if (settled && !('code' in settled) && settled.receipt && receiptMatches(settled.receipt, journal)) {
        forget();
        succeed(row, `재출고를 등록했습니다(${draft.trackingNumber.trim().toUpperCase()}).`);
        continue;
      }
      if (settled && !('code' in settled) && settled.receipt?.state === 'sealed') {
        forget();
        stop = PREVIOUS_FAILED;
        fail(row, response && 'code' in response ? response.message : '재출고를 등록하지 못했습니다. 요청 상세에서 확인해주세요.');
        continue;
      }
      /* 결과를 끝내 읽지 못했다. 요청번호를 남겨 상세가 [저장 결과 확인]을 띄우게 한다. */
      stop = PREVIOUS_FAILED;
      fail(row, OUTCOME_UNKNOWN);
    }
    return stop ? 'stopped' : 'ok';
  }

  const busy = phase !== 'idle';
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-claim-bulk-reship="">
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy} onClick={() => { void loadAddresses(); }} variant={hasPrivate ? 'outline' : 'default'}>{hasPrivate ? '최종 주소 다시 불러오기' : `최종 주소 불러오기 (${load.claims.length}건)`}</Button>
      <p className="text-xs text-muted-foreground">주소는 확인 시간 10분 동안만 보이고, 탭을 가리거나 등록이 끝나면 지웁니다.</p>
    </div>
    {load.claims.map((claim) => {
      const context = contexts[claim.claimId];
      return <section aria-label={`요청 ${claim.reference} 재출고`} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-claim-bulk-reship-claim={claim.claimId} key={claim.claimId}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-medium tabular-nums">{claim.reference}</h4>
          {claim.skipped.length > 0 ? <p className="text-xs text-muted-foreground">{claim.skipped.map((entry) => `${entry.originName}: 상세에서 처리`).join(' · ')}</p> : null}
        </div>
        <div data-private="true">{context?.status === 'ready'
          ? <p className="rounded-lg bg-muted/50 px-3 py-2">{context.address.recipientName} · {context.address.phone}<br />({context.address.postalCode}) {context.address.address1} {context.address.address2}</p>
          : context?.status === 'loading' ? <p className="text-muted-foreground" role="status">최종 주소를 불러오는 중입니다…</p>
            : context?.status === 'unavailable' ? <p className="text-destructive">{adminClaimCopy(context.message)}</p>
              : <p className="text-muted-foreground">최종 주소를 불러오면 여기에 보입니다.</p>}</div>
        {claim.rows.map((row) => {
          const key = reshipRowKey(claim.claimId, row.shipmentId);
          const draft = drafts[key];
          return <div className="grid min-w-0 gap-3 border-t pt-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" data-claim-bulk-reship-row={key} key={key}>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-medium">{originLabel(row)}</p>
              {row.items.map((item) => <label className="flex min-w-0 flex-col gap-1" key={item.orderItemId}>
                <span className="text-xs text-muted-foreground">{item.name}{item.variantName ? ` · ${item.variantName}` : ''} · {item.qty}개 재출고 상품</span>
                <NativeSelect className="w-full" disabled={busy} onChange={(event) => patch(key, { items: { ...draft.items, [item.orderItemId]: event.target.value } })} value={draft.items[item.orderItemId] ?? ''}>
                  <option disabled value="">재출고할 상품 선택</option>
                  {item.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </NativeSelect>
              </label>)}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`${key}-carrier`}>택배사</Label>
              <NativeSelect className="w-full" disabled={busy} id={`${key}-carrier`} onChange={(event) => patch(key, { carrier: event.target.value })} value={draft.carrier}>
                <option disabled value="">택배사 선택</option>
                {load.carriers.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}
              </NativeSelect>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`${key}-tracking`}>재출고 운송장번호</Label>
              <Input autoComplete="off" disabled={busy} id={`${key}-tracking`} onChange={(event) => patch(key, { trackingNumber: event.target.value })} placeholder="영문과 숫자 8~30자" value={draft.trackingNumber} />
            </div>
          </div>;
        })}
      </section>;
    })}
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-2 leading-relaxed">
        <Checkbox checked={destinationConfirmed} className="mt-0.5" disabled={busy || !hasPrivate} onCheckedChange={(value) => setDestinationConfirmed(!!value)} />
        <span>위에 보인 최종 주소가 요청마다 실제로 발송할 주소와 같습니다.</span>
      </label>
      <label className="flex items-start gap-2 leading-relaxed">
        <Checkbox checked={dispatchConfirmed} className="mt-0.5" disabled={busy} onCheckedChange={(value) => setDispatchConfirmed(!!value)} />
        <span>출고지마다 전체 수량과 실제 발송 정보(택배사·운송장·상품)를 확인했습니다.</span>
      </label>
      <p className="text-xs text-muted-foreground">출고지마다 회수한 상품의 재고를 복원하고 고른 상품으로 재출고합니다. 모든 출고지를 보내면 교환이 종결됩니다. 결제금액과 카드팩은 유지됩니다.</p>
    </div>
    {error ? <p className="text-destructive" role="alert">{adminClaimCopy(error)}</p> : null}
    {phase === 'running' ? <p className="text-muted-foreground" role="status">재출고를 한 줄씩 등록하는 중입니다({progress}줄 끝). 창을 닫지 마세요.</p> : null}
    <DialogFooter>
      <p className="mr-auto self-center" data-claim-bulk-summary="">주소 확인 <strong>{readyClaims.length}건</strong> · 출고지 {readyRows}곳</p>
      <Button disabled={busy || readyRows === 0} onClick={() => { void register(); }}>{readyClaims.length}건 · 출고지 {readyRows}곳 재출고 등록</Button>
    </DialogFooter>
  </div>;
}
