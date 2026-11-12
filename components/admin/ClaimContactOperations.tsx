'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, CLAIM_CONTACT_JOURNAL_PREFIX, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeClaimContact, fetchClaimContactContext, readOrSealClaimContactOperation, recordClaimReshipmentV2 } from '@/lib/claim-contact/client';
import { claimContactError, normalizeClaimContactChangeRequest, normalizeClaimContactReshipmentRequest, parseClaimContactJournal,
  type ChangeRequest, type ClaimContactJournal, type Command, type ContextResponse, type ErrorResponse, type OperationReceipt,
  type OperationRequest, type ReshipmentRequest, type Target } from '@/lib/claim-contact/contracts';
import type { AdminClaimReshipItem } from '@/lib/admin/claims.server';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { cn } from 'cn';
import { CLAIM_EVIDENCE_ACCEPT, CLAIM_EVIDENCE_MAX_FILES, CLAIM_WAIVER_REASON_MAX, CLAIM_WAIVER_REASON_MIN, claimEvidenceUrl,
  claimWaiverReasonValid, normalizeClaimWaiverReason, type ClaimEvidenceFile } from '@/lib/admin/claim-evidence';
import { uploadClaimEvidence } from '@/lib/admin/claim-evidence.client';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const CHECK ='flex items-start gap-2 leading-relaxed';

/**
 * 아직 재출고하지 않은 배송 건(출고지) 하나(TKT-166). shipmentId가 null이면 배송 건 없는 옛 주문 전체다.
 * collected가 false면 회수 확인 전이라 waivable(하자·오배송 교환)일 때만 '회수 없이 재출고'로 보낼 수 있다.
 */
export interface ClaimContactReshipTarget {
  shipmentId: string | null;
  originName: string | null;
  collected: boolean;
  waivable: boolean;
  orderItemIds: readonly string[];
}
type Props = { actorId: string; orderId: string; claimId: string; carriers: ShippingCarrierRegistry; reshipItems: readonly AdminClaimReshipItem[];
  /** 지금 재출고를 등록할 수 있는 배송 건. 비어 있으면 재출고 등록 버튼을 그리지 않는다. */
  reshipTargets: readonly ClaimContactReshipTarget[] };
type Draft = { recipientName: string; phone: string; postalCode: string; address1: string; address2: string; agreement: string; customerConfirmed: boolean; handoffConfirmed: boolean;
  carrier: string; trackingNumber: string; items: Record<string, string>; destinationConfirmed: boolean; dispatchConfirmed: boolean;
  waiveCollection: boolean; waiverReason: string; evidence: ClaimEvidenceFile[] };
const blank = (): Draft => ({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', agreement: '', customerConfirmed: false, handoffConfirmed: false,
  carrier: '', trackingNumber: '', items: {}, destinationConfirmed: false, dispatchConfirmed: false, waiveCollection: false, waiverReason: '', evidence: [] });
const targetKey = (target: ClaimContactReshipTarget) => target.shipmentId ?? 'order';
const targetName = (target: ClaimContactReshipTarget) => target.originName ?? '주문 전체';
const targetLabel = (target: Target) => target === 'collection' ? '회수지' : '재배송지';
type Dispatched = { command: Command; request: ChangeRequest | ReshipmentRequest };

export function claimContactJournalKey(identity: ClaimContactIdentity, orderId: string, claimId: string) {
  // One pending operation locks both address targets and dispatch in this tab.
  return `${CLAIM_CONTACT_JOURNAL_PREFIX}${identity.actorId}:${identity.sessionId}:${orderId}:${claimId}`;
}
function readJournal(key: string, identity: ClaimContactIdentity, orderId: string, claimId: string) {
  try {
    const value = parseClaimContactJournal(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (value?.actorId === identity.actorId && value.sessionId === identity.sessionId && value.orderId === orderId && value.claimId === claimId) return value;
    sessionStorage.removeItem(key);
  } catch { /* A write still requires successful journal persistence. */ }
  return null;
}
function receiptMatches(receipt: OperationReceipt, journal: ClaimContactJournal) {
  return receipt.operationId === journal.operationId && receipt.actorId === journal.actorId && receipt.sessionId === journal.sessionId
    && receipt.orderId === journal.orderId && receipt.claimId === journal.claimId && receipt.command === journal.command
    && receipt.target === journal.target && receipt.expectedClaimType === journal.expectedClaimType && receipt.expectedClaimRevision === journal.expectedClaimRevision;
}

export function ClaimContactOperationPanel({ identity, scope, orderId, claimId, carriers, reshipItems, reshipTargets }: Omit<Props, 'actorId'> & {
  identity: ClaimContactIdentity; scope: ClaimContactScope;
}) {
  const router = useRouter(), key = claimContactJournalKey(identity, orderId, claimId);
  const [context, setContext] = useState<ContextResponse | null>(null), [draft, setDraft] = useState<Draft>(blank);
  const [recovery, setRecovery] = useState<ClaimContactJournal | null>(() => readJournal(key, identity, orderId, claimId));
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [canRetry, setCanRetry] = useState(false);
  /* 재출고 확인을 연 배송 건. 확인 창 하나는 배송 건 하나만 다룬다. */
  const [reshipTarget, setReshipTarget] = useState<ClaimContactReshipTarget | null>(null);
  const [uploading, setUploading] = useState(false);
  const canReship = reshipTargets.length > 0;
  const alive = useRef(true), busy = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const dispatched = useRef<Dispatched | null>(null);
  const dirty = Boolean(context || recovery);

  function clearPrivate() { setContext(null); setDraft(blank()); setReshipTarget(null); dispatched.current = null; setCanRetry(false); }
  function closePrivate() { generation.current++; controller.current?.abort(); clearPrivate(); }
  useEffect(() => {
    alive.current = true; generation.current++;
    const hide = () => { if (document.visibilityState !== 'visible') { generation.current++; controller.current?.abort(); setContext(null); setDraft(blank()); dispatched.current = null; setCanRetry(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; controller.current?.abort(); dispatched.current = null; document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => {
    if (!context?.expiresAt || recovery) return;
    const timeout = window.setTimeout(() => { setContext(null); setDraft(blank()); setError('주소 확인 시간이 지났습니다. 최신 주소를 다시 확인해주세요.'); }, Math.max(0, Date.parse(context.expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [context?.expiresAt, recovery]);
  useAdminLeaveGuard({ dirty, message: '입력한 연락처는 보관하지 않습니다. 미확정 요청은 다시 열어 처리 결과를 확인할 수 있습니다. 이동할까요?' });

  function begin() {
    const ticket = scope.capture(); if (busy.current || !ticket) return null;
    busy.current = true; setPending(true); setError(''); setMessage('');
    const epoch = ++generation.current, abort = new AbortController(); controller.current = abort;
    return { valid: () => alive.current && generation.current === epoch && scope.canApply(ticket),
      options: { signal: abort.signal, expectedIdentity: identity } };
  }
  function end() { busy.current = false; controller.current = null; if (alive.current) setPending(false); }
  function fail(failure: ErrorResponse) {
    setError(failure.message);
    if (failure.authChanged) { clearPrivate(); scope.authenticate(null, null); }
    else if (failure.recoveryOnly && !failure.uncertain) clearPrivate();
    // A late error cannot prove the original request did not commit. Keep its
    // metadata until a receipt or an explicit server seal is read back.
  }
  function accept(receipt: OperationReceipt, original: ClaimContactJournal) {
    if (!receiptMatches(receipt, original)) { setError('현재 요청과 다른 결과입니다. 저장 결과를 다시 확인해주세요.'); return; }
    try { sessionStorage.removeItem(key); } catch { /* A retained journal can only recover this completed operation. */ }
    setRecovery(null); clearPrivate(); setError('');
    setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 주소를 확인한 뒤 다시 입력해주세요.'
      : receipt.state === 'noop' ? '변경할 내용이 없어 기존 연락처를 유지했습니다.'
        : receipt.command === 'reshipment' ? '확인한 재배송지와 이 배송 건의 실제 재출고를 기록했습니다.' : `${targetLabel(receipt.target)} 연락처를 수정했습니다.`);
    router.refresh();
  }
  async function load(target: Target, command: Command, shipment: ClaimContactReshipTarget | null = null) {
    if (recovery || (command === 'reshipment' && (!canReship || !shipment))) return;
    const run = begin(); if (!run) return; clearPrivate();
    try {
      const result = await fetchClaimContactContext({ requestId: crypto.randomUUID(), orderId, claimId, target, command }, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else {
        setContext(result); setReshipTarget(command === 'reshipment' ? shipment : null);
        setDraft({ ...blank(), recipientName: result.address?.recipientName ?? '', phone: result.address?.phone ?? '', postalCode: result.address?.postalCode.trim() ?? '', address1: result.address?.address1.trim() ?? '', address2: result.address?.address2 ?? '',
          carrier: carriers.find(carrier => carrier.active)?.code ?? '', items: Object.fromEntries(reshipItems.map(item => [item.id, item.currentVariantId])),
          waiveCollection: command === 'reshipment' && shipment !== null && !shipment.collected });
      }
    } catch { if (run.valid()) setError('현재 주소를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { end(); }
  }
  async function save(retry = false) {
    if (busy.current || (!retry && recovery) || retry && !dispatched.current) return;
    if (!retry && (!context?.allowed || !context.address || !context.signedContext)) return;
    if (!retry && (!context!.expiresAt || Date.parse(context!.expiresAt) <= Date.now())) { closePrivate(); setError('주소 확인 시간이 지났습니다. 최신 주소를 다시 확인해주세요.'); return; }
    const operationId = crypto.randomUUID();
    if (!retry && context!.command === 'reshipment') {
      /* 회수 확인 전 배송 건은 회수 생략(사유·근거 사진)으로만 보낼 수 있다. DB가 같은 조건을 다시 확인한다. */
      if (!reshipTarget) { setError('재출고할 배송 건을 다시 골라주세요.'); return; }
      if (!reshipTarget.collected && !(reshipTarget.waivable && draft.waiveCollection)) { setError('이 배송 건의 회수 확인이 먼저 필요합니다. 하자·오배송 교환은 회수 없이 재출고할 수 있습니다.'); return; }
      if (draft.waiveCollection && (!claimWaiverReasonValid(draft.waiverReason) || draft.evidence.length < 1)) {
        setError(`회수 생략 사유(${CLAIM_WAIVER_REASON_MIN}~${CLAIM_WAIVER_REASON_MAX}자)와 근거 사진 1장 이상을 남겨주세요.`); return;
      }
      if (uploading) { setError('근거 사진을 올리는 중입니다. 끝난 뒤 다시 눌러주세요.'); return; }
    }
    const targetItems = reshipTarget ? reshipItems.filter(item => reshipTarget.orderItemIds.includes(item.id)) : [];
    const request = retry ? dispatched.current!.request : context!.command === 'change'
      ? normalizeClaimContactChangeRequest({ requestId: crypto.randomUUID(), orderId, claimId, target: context!.target, operationId, signedContext: context!.signedContext,
        contact: { recipientName: draft.recipientName, phone: draft.phone, address2: draft.address2,
          ...(draft.postalCode.trim() !== context!.address!.postalCode.trim() || draft.address1.trim() !== context!.address!.address1.trim() ? { postalCode: draft.postalCode, address1: draft.address1 } : {}) }, agreement: draft.agreement,
        customerConfirmed: draft.customerConfirmed, handoffNotStartedConfirmed: draft.handoffConfirmed })
      : normalizeClaimContactReshipmentRequest({ requestId: crypto.randomUUID(), orderId, claimId, operationId, signedContext: context!.signedContext,
        shipmentId: reshipTarget?.shipmentId ?? null, carrier: draft.carrier, trackingNumber: draft.trackingNumber,
        items: targetItems.map(item => ({ orderItemId: item.id, variantId: draft.items[item.id] })),
        collectionWaiver: draft.waiveCollection ? { reason: normalizeClaimWaiverReason(draft.waiverReason), evidenceFileIds: draft.evidence.map(file => file.id) } : null,
        destinationConfirmed: draft.destinationConfirmed, dispatchConfirmed: draft.dispatchConfirmed });
    if (!request) { setError('연락처·합의 근거 또는 재출고 정보와 확인 항목을 모두 확인해주세요.'); return; }
    const command = retry ? dispatched.current!.command : context!.command;
    const journal = retry ? recovery : parseClaimContactJournal({ operationId: request.operationId, orderId, claimId, command,
      target: context!.target, expectedClaimType: context!.claimType, expectedClaimRevision: context!.claimRevision,
      actorId: identity.actorId, sessionId: identity.sessionId, startedAt: new Date().toISOString() });
    if (!journal) { setError('요청 상태를 확인하지 못했습니다. 최신 주소를 다시 확인해주세요.'); return; }
    const run = begin(); if (!run) return;
    try {
      try { sessionStorage.setItem(key, JSON.stringify(journal)); } catch { setError('요청번호를 보관할 수 없습니다. 브라우저 저장소를 확인해주세요.'); return; }
      dispatched.current = { command, request }; setRecovery(journal); setCanRetry(true);
      const result = command === 'change' ? await changeClaimContact(request, run.options) : await recordClaimReshipmentV2(request, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else if (result.receipt) accept(result.receipt, journal);
      else setError(claimContactError('claim_contact_outcome_unknown').message);
    } catch { if (run.valid()) setError(claimContactError('claim_contact_outcome_unknown').message); }
    finally { end(); }
  }
  async function check(sealIfAbsent = false) {
    if (!recovery) return;
    const original = recovery, run = begin(); if (!run) return;
    try {
      const request: OperationRequest = { requestId: crypto.randomUUID(), sealIfAbsent, orderId: original.orderId, claimId: original.claimId,
        operationId: original.operationId, command: original.command, target: original.target,
        expectedClaimType: original.expectedClaimType, expectedClaimRevision: original.expectedClaimRevision };
      const result = await readOrSealClaimContactOperation(request, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else if (result.receipt) accept(result.receipt, original);
      else setMessage('아직 저장 결과가 없습니다. 같은 내용으로 다시 요청하거나 미처리 요청을 종료한 뒤 새로 입력해주세요.');
    } catch { if (run.valid()) setError(claimContactError('claim_contact_outcome_unknown').message); }
    finally { end(); }
  }
  const locked = pending || Boolean(recovery) || !context?.allowed || !context.address || !context.signedContext;
  const patch = (value: Partial<Draft>) => setDraft(previous => ({ ...previous, ...value }));
  async function addEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length || uploading) return;
    const room = CLAIM_EVIDENCE_MAX_FILES - draft.evidence.length;
    if (room < 1) { setError(`근거 사진은 ${CLAIM_EVIDENCE_MAX_FILES}장까지 올릴 수 있습니다.`); return; }
    setUploading(true); setError('');
    try {
      for (const file of files.slice(0, room)) {
        const result = await uploadClaimEvidence(claimId, file);
        if (!alive.current) return;
        if (!result.ok) { setError(result.error); break; }
        setDraft(previous => previous.evidence.length >= CLAIM_EVIDENCE_MAX_FILES ? previous : { ...previous, evidence: [...previous.evidence, result.file] });
      }
      if (files.length > room) setError(`근거 사진은 ${CLAIM_EVIDENCE_MAX_FILES}장까지 올릴 수 있어 앞의 ${room}장만 올렸습니다.`);
    } finally { if (alive.current) setUploading(false); }
  }
  const targetItems = reshipTarget ? reshipItems.filter(item => reshipTarget.orderItemIds.includes(item.id)) : [];
  const lastTarget = reshipTargets.length === 1;
  return <section aria-label="회수·재배송 연락처 처리" className="flex min-w-0 flex-col gap-3 text-sm break-words" data-claim-contact="">
    <h3 className="text-sm leading-snug font-medium text-foreground">회수·재배송 연락처</h3>
    <p className="text-muted-foreground">수거·재배송을 시작하기 전에 받는 분, 연락처와 주소 전체를 수정합니다. 지역 요금이 달라지거나 요금 근거를 확인할 수 없는 변경은 저장하지 않습니다.</p>
    <div className="flex flex-wrap gap-2">
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('collection', 'change'); }}>회수지 연락처 확인</button>
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('reshipment', 'change'); }}>재배송지 연락처 확인</button>
      {reshipTargets.map(target => <button className={PRIMARY} data-slot="button" key={targetKey(target)} type="button" disabled={pending || Boolean(recovery)}
        data-claim-reship-target={targetKey(target)} onClick={() => { void load('reshipment', 'reshipment', target); }}>
        {reshipTargets.length > 1 || target.originName ? `${targetName(target)} 재출고 등록` : '최종 주소 확인 후 재출고 등록'}{!target.collected ? ' (회수 없이)' : ''}
      </button>)}
    </div>
    {reshipTargets.length > 1 ? <p className="text-muted-foreground">출고지마다 따로 재출고합니다. 버튼을 누를 때마다 최종 주소를 다시 확인합니다.</p> : null}
    {context ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-private="true">
      <h4 className="font-medium">{context.command === 'reshipment' ? `${reshipTarget ? `${targetName(reshipTarget)} ` : ''}재출고 최종 주소 확인` : `${targetLabel(context.target)} 연락처 수정`}</h4>
      {context.referenceOnly ? <p className="text-muted-foreground">{context.sourceKind === 'seller_intake' ? '최초 접수 당시 주소를 참고합니다.' : '원주문 배송지를 참고합니다.'} 확인만으로 연락처가 수정되지는 않습니다.</p> : null}
      {context.address ? <p className="rounded-lg bg-muted/50 px-3 py-2.5">{context.address.recipientName} · {context.address.phone}<br />({context.address.postalCode}) {context.address.address1}<br />{context.address.address2}</p>
        : <p className="text-muted-foreground">{context.piiState === 'purged' ? '주소 원문이 파기되어 표시하지 않습니다.' : context.unavailableReason === 'retention_due' ? '주소 보관기간이 지나 내용을 표시하지 않습니다.' : '현재 주소를 표시할 수 없습니다.'}</p>}
      {!context.allowed ? <p role="status">{claimContactError('claim_contact_blocked').message}</p> : null}
      {context.allowed && context.address ? <form autoComplete="off" className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
          <legend className="mb-1 font-medium">{context.command === 'change' ? '연락처와 고객 확인' : '실제 발송 정보'}</legend>
          {context.command === 'change' ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD}><span className={FIELD_LABEL}>받는 분</span><input autoComplete="off" className="w-full" required value={draft.recipientName} onChange={event => patch({ recipientName: event.target.value })} /></label>
              <label className={FIELD}><span className={FIELD_LABEL}>연락처</span><input autoComplete="off" className="w-full" inputMode="tel" required value={draft.phone} onChange={event => patch({ phone: event.target.value })} /></label>
            </div>
            <label className={FIELD}><span className={FIELD_LABEL}>우편번호</span><input autoComplete="off" className="w-full sm:w-40" inputMode="numeric" pattern={draft.postalCode.trim() !== context.address!.postalCode.trim() || draft.address1.trim() !== context.address!.address1.trim() ? "[0-9]{5}" : undefined} maxLength={20} required value={draft.postalCode} onChange={event => patch({ postalCode: event.target.value })} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>기본 주소</span><input autoComplete="off" className="w-full" maxLength={200} required value={draft.address1} onChange={event => patch({ address1: event.target.value })} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>상세주소</span><input autoComplete="off" className="w-full" value={draft.address2} onChange={event => patch({ address2: event.target.value })} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>고객 합의 근거</span><textarea className="w-full" required rows={3} value={draft.agreement} onChange={event => patch({ agreement: event.target.value })} /></label>
            <p className="text-xs text-muted-foreground">받는 분 50자, 연락처 숫자 8~15자리, 우편번호 5자리, 기본·상세주소 각각 200자, 합의 근거 2~500자까지 입력할 수 있습니다.</p>
            <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.customerConfirmed} onChange={event => patch({ customerConfirmed: event.target.checked })} /><span>고객과 변경 내용을 확인했습니다.</span></label>
            <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.handoffConfirmed} onChange={event => patch({ handoffConfirmed: event.target.checked })} /><span>{context.target === 'collection' ? '택배사 수거가 시작되지 않은 것을 확인했습니다.' : '교환품을 아직 발송하지 않은 것을 확인했습니다.'}</span></label>
          </> : <>
            {reshipTarget && !reshipTarget.collected ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-claim-collection-waiver="">
              <AdminNotice tone="warning" title="이 배송 건은 아직 회수를 확인하지 않았습니다.">{reshipTarget.waivable
                ? '하자·오배송 교환은 사유와 근거 사진을 남기고 회수 없이 재출고할 수 있습니다.' : '회수를 확인한 뒤에 재출고합니다.'}</AdminNotice>
              {reshipTarget.waivable ? <>
                <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.waiveCollection} onChange={event => patch({ waiveCollection: event.target.checked })} />
                  <span>하자·오배송이라 회수 확인 없이 재출고합니다. 회수 상품 재고는 복원하지 않습니다.</span></label>
                <label className={FIELD}><span className={FIELD_LABEL}>회수 생략 사유</span>
                  <textarea className="w-full" maxLength={CLAIM_WAIVER_REASON_MAX} rows={3} value={draft.waiverReason} onChange={event => patch({ waiverReason: event.target.value })}
                    placeholder="예: 고객 사진으로 인쇄 불량 확인, 회수 없이 같은 옵션 재발송" /></label>
                <p className="text-xs text-muted-foreground">사유 {CLAIM_WAIVER_REASON_MIN}~{CLAIM_WAIVER_REASON_MAX}자, 근거 사진 1~{CLAIM_EVIDENCE_MAX_FILES}장(JPG·PNG·WebP). 고객에게는 사유와 사진이 보이지 않습니다.</p>
                <label className={FIELD}><span className={FIELD_LABEL}>근거 사진</span>
                  <input accept={CLAIM_EVIDENCE_ACCEPT} className="w-full" disabled={uploading || draft.evidence.length >= CLAIM_EVIDENCE_MAX_FILES} multiple type="file"
                    onChange={event => { void addEvidence(event); }} /></label>
                {uploading ? <p className="text-muted-foreground" role="status">근거 사진을 올리고 있습니다.</p> : null}
                {draft.evidence.length ? <ul className="flex flex-wrap gap-2" aria-label="올린 근거 사진">{draft.evidence.map((file, index) => <li className="flex items-center gap-1.5" key={file.id}>
                  <a className="underline underline-offset-4" href={claimEvidenceUrl(file.id)} rel="noreferrer" target="_blank">사진 {index + 1}</a>
                  <button className={OUTLINE} data-slot="button" type="button" onClick={() => patch({ evidence: draft.evidence.filter(item => item.id !== file.id) })}>빼기</button>
                </li>)}</ul> : null}
              </> : null}
            </div> : null}
            {targetItems.map(item => <label className={FIELD} key={item.id}><span className={FIELD_LABEL}>{item.name} · {item.qty}개 재출고 상품</span><select className="w-full" required value={draft.items[item.id] ?? ''} onChange={event => patch({ items: { ...draft.items, [item.id]: event.target.value } })}>
              <option value="" disabled>재출고할 상품 선택</option>{item.options.map(option => <option key={option.id} value={option.id}>{option.goodName ? `${option.goodName} · ` : ''}{option.name} · {option.code} · 재고 {option.stockQty}개</option>)}
            </select></label>)}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD}><span className={FIELD_LABEL}>택배사</span><select className="w-full" required value={draft.carrier} onChange={event => patch({ carrier: event.target.value })}><option value="" disabled>택배사 선택</option>{carriers.filter(carrier => carrier.active).map(carrier => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}</select></label>
              <label className={FIELD}><span className={FIELD_LABEL}>재출고 운송장번호</span><input autoComplete="off" className="w-full" required value={draft.trackingNumber} onChange={event => patch({ trackingNumber: event.target.value })} placeholder="영문과 숫자 8~30자" /></label>
            </div>
            <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.destinationConfirmed} onChange={event => patch({ destinationConfirmed: event.target.checked })} /><span>표시된 최종 주소가 실제 발송할 주소와 같습니다.</span></label>
            <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.dispatchConfirmed} onChange={event => patch({ dispatchConfirmed: event.target.checked })} /><span>전체 수량과 실제 발송 정보를 확인했습니다.</span></label>
            <p className="text-muted-foreground">{draft.waiveCollection
              ? '회수 상품 재고는 복원하지 않고, 선택한 상품의 재고만 줄입니다. 고객에게는 회수 없이 다시 보내드린다고 안내합니다. 결제금액과 카드팩은 유지됩니다.'
              : '이 배송 건에서 회수한 상품의 재고를 복원하고 선택한 상품으로 전체 수량을 재출고합니다. 결제금액과 카드팩은 유지됩니다.'}</p>
          </>}
        </fieldset>
        {!recovery ? <button className={`${PRIMARY} w-fit`} data-slot="button" disabled={locked || uploading} type="submit">{context.command === 'change' ? '연락처 수정 저장'
          : lastTarget ? '재출고 등록하고 교환 종결' : '이 배송 건 재출고 등록'}</button> : null}
      </form> : null}
      <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" onClick={closePrivate}>연락처 닫기</button>
    </div> : null}
    {recovery ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-destructive" role="alert">{targetLabel(recovery.target)} {recovery.command === 'reshipment' ? '재출고' : '연락처 수정'} 요청의 결과를 먼저 확인해주세요. 주소 원문 없이 요청번호만 이 탭에 보관합니다.</p>
      <p className="text-muted-foreground">요청 시각 {formatOrderDateTime(recovery.startedAt)}</p>
      <div className="flex flex-wrap gap-2">
        <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void check(); }}>저장 결과 확인</button>
        {canRetry ? <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(true); }}>같은 내용으로 다시 요청</button> : null}
        <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void check(true); }}>미처리 요청 종료</button>
      </div>
    </div> : null}
    {pending ? <p className="text-muted-foreground" role="status">처리 결과를 확인하고 있습니다.</p> : null}
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
  </section>;
}

export function ClaimContactOperations({ actorId, ...props }: Props) {
  return <ClaimContactSession actorId={actorId}>{(identity, scope) => <ClaimContactOperationPanel key={`${props.orderId}:${props.claimId}:${identity.sessionId}`} {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
