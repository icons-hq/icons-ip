'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { ClaimContactSession, CLAIM_CONTACT_JOURNAL_PREFIX, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeClaimContact, fetchClaimContactContext, readOrSealClaimContactOperation, recordClaimReshipmentV2 } from '@/lib/claim-contact/client';
import { claimContactError, normalizeClaimContactChangeRequest, normalizeClaimContactReshipmentRequest, parseClaimContactJournal,
  type ChangeRequest, type ClaimContactJournal, type Command, type ContextResponse, type ErrorResponse, type OperationReceipt,
  type OperationRequest, type ReshipmentRequest, type Target } from '@/lib/claim-contact/contracts';
import type { AdminClaimReshipItem } from '@/lib/admin/claims.server';
import { adminClaimReshipSelectableOptions } from '@/lib/admin/claim-reshipments';
import { adminConfirm, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL, SAVE_STOP_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { adminPickerLocalLoader } from '@/lib/admin/picker';
import type { OrderClaimType } from '@/lib/orders/claims';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { AdminPickerDialog } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { cn } from 'cn';
import { CLAIM_EVIDENCE_ACCEPT, CLAIM_EVIDENCE_MAX_FILES, CLAIM_WAIVER_REASON_MAX, CLAIM_WAIVER_REASON_MIN, claimEvidenceUrl,
  claimWaiverReasonValid, normalizeClaimWaiverReason, type ClaimEvidenceFile } from '@/lib/admin/claim-evidence';
import { uploadClaimEvidence } from '@/lib/admin/claim-evidence.client';

/*
 * 교환 재출고 등록과 회수지·교환품 받을 곳 고치기(TKT-166).
 *
 * 한 화면에 두 가지 일이 있어 제목을 나눈다: '재출고 등록'(출고지마다 버튼 하나)과 주소 고치기(회수지 / 교환품 받을 곳).
 * 이름(화면 규칙 4): 다시 보내는 일은 '재출고', 고객이 받을 주소는 '교환품 받을 곳', 택배사가 가지러 가는 주소는 '회수지'다.
 * 확인 체크는 두지 않는다. 계약이 요구하는 확인 값(주소·발송·고객 확인)은 화면이 true로 채워 보내고,
 * 재고가 줄고 교환이 끝나는 재출고 등록은 보낸 내용과 결과를 확인창으로 한 번 묻는다. 주소 고치기는 다시 고칠 수 있어 묻지 않는다.
 * 주소 원문은 탭이 가려지거나 10분이 지나면 지운다 — 확인창에도 주소를 옮겨 적지 않고, 주소는 양식 위에 그대로 보인다.
 */

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const FIELD_LIMIT = 'font-normal text-muted-foreground';
const HINT = 'text-xs text-muted-foreground';
const HEADING = 'text-sm leading-snug font-medium text-foreground';

/** 결과를 모를 때의 두 버튼(낱말 표). 같은 내용 다시 보내기는 처음 보낸 내용이 화면에 남아 있을 때만 보인다. */
const SEAL_LABEL = SAVE_STOP_LABEL;
const RETRY_LABEL = '같은 내용으로 다시 저장';
const EXPIRED = '주소 확인 시간이 지났습니다. 최신 주소를 다시 확인해주세요.';
const LOAD_FAILED = '현재 주소를 불러오지 못했습니다. 버튼을 다시 눌러주세요.';

/**
 * 아직 재출고하지 않은 배송 건(출고지) 하나(TKT-166). shipmentId가 null이면 배송 건 없는 옛 주문 전체다.
 * collected가 false면 회수 확인 전이라 waivable(하자·오배송 교환)일 때만 '회수 없이 재출고'로 보낼 수 있고,
 * waived면 회수 생략을 이미 결정한 배송 건(주문제작)이라 사유·사진을 다시 받지 않고 회수 없이 보낸다.
 */
export interface ClaimContactReshipTarget {
  shipmentId: string | null;
  originName: string | null;
  collected: boolean;
  waivable: boolean;
  waived?: boolean;
  orderItemIds: readonly string[];
  /** 회수품 재고 처리에서 불량으로 고른 품목(CLM-046). 재출고 때 판매 재고로 되돌리지 않고 불량 재고에 기록된다. */
  defectiveOrderItemIds?: readonly string[];
}
type Props = { actorId: string; orderId: string; claimId: string; carriers: ShippingCarrierRegistry; reshipItems: readonly AdminClaimReshipItem[];
  /** 지금 재출고를 등록할 수 있는 배송 건. 비어 있으면 재출고 등록 버튼을 그리지 않는다. */
  reshipTargets: readonly ClaimContactReshipTarget[];
  /** 아직 재출고하지 않은 대상 배송 건 수(등록할 수 없는 배송 건 포함). 1이면 이번 재출고가 교환을 종결한다. 없으면 reshipTargets 수다. */
  remainingTargets?: number;
  /** 회수를 확인했지만 회수품 재고 처리를 정하지 않아 재출고를 열지 않은 출고지 이름(하자·오배송 교환, CLM-046). */
  stockDecisionPendingOrigins?: readonly string[];
  /** 요청 유형. 반품이면 쓸 일이 없는 '교환품 받을 곳' 버튼을 그리지 않는다. 주지 않으면 두 버튼을 모두 그린다. */
  claimType?: OrderClaimType };
type Draft = { recipientName: string; phone: string; postalCode: string; address1: string; address2: string; agreement: string;
  carrier: string; trackingNumber: string; items: Record<string, string>;
  waiveCollection: boolean; waiverReason: string; evidence: ClaimEvidenceFile[] };
const blank = (): Draft => ({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', agreement: '',
  carrier: '', trackingNumber: '', items: {}, waiveCollection: false, waiverReason: '', evidence: [] });
const targetKey = (target: ClaimContactReshipTarget) => target.shipmentId ?? 'order';
const targetName = (target: ClaimContactReshipTarget) => target.originName ?? '주문 전체';
const TARGETS: Record<Target, { name: string; open: string; saved: string; handoff: string }> = {
  collection: { name: '회수지', open: '회수지 보기·고치기', saved: '회수지를 고쳤습니다.', handoff: '택배사에 이미 회수를 접수했다면 택배사에도 바뀐 주소를 알려 주세요.' },
  reshipment: { name: '교환품 받을 곳', open: '교환품 받을 곳 보기·고치기', saved: '교환품 받을 곳을 고쳤습니다.', handoff: '이미 보낸 교환품에는 반영되지 않습니다.' },
};
type Dispatched = { command: Command; request: ChangeRequest | ReshipmentRequest };
type ReshipOption = AdminClaimReshipItem['options'][number];
const optionLabel = (option: ReshipOption) => `${option.goodName ? `${option.goodName} · ` : ''}${option.name}`;

/**
 * 재출고 등록 확인창. 등록하면 재고가 바뀌고 고객에게 알림이 가며 되돌릴 수 없어, 보낸 내용(출고지·택배사·운송장·상품×수량)과
 * 결과(재고·교환 종결)를 한 번 보여 준다. 받는 분·주소는 싣지 않는다(양식 위에 보이는 주소를 그대로 기록한다).
 */
export function claimReshipmentConfirmRequest({ originName, carrierLabel, trackingNumber, items, stock, defectiveNames = [], closes }: {
  originName: string; carrierLabel: string; trackingNumber: string;
  items: readonly { name: string; option: string; qty: number }[];
  /** 회수품 재고: 되돌린다(restore) · 회수 없이 보내 되돌리지 않는다(waived) · 불량으로 고른 품목은 불량 재고에 적는다(defective). */
  stock: 'restore' | 'waived' | 'defective'; defectiveNames?: readonly string[]; closes: boolean;
}): AdminConfirmRequest {
  const stockLine = stock === 'waived' ? '회수한 상품이 없어 재고를 되돌리지 않고, 보내는 상품의 재고만 줄입니다. 고객에게는 회수 없이 다시 보낸다고 알립니다.'
    : stock === 'defective' ? `불량으로 고른 회수 상품(${defectiveNames.join(', ')})은 불량 재고에 적고, 나머지 회수 상품의 재고는 되돌립니다. 보내는 상품의 재고는 줄입니다.`
      : '회수한 상품의 재고를 되돌리고, 보내는 상품의 재고를 줄입니다.';
  return {
    title: `${originName} 재출고를 등록할까요?`,
    message: [
      `${carrierLabel} ${trackingNumber}`,
      ...items.map(item => `${item.name} → ${item.option} ${item.qty}개`),
      '받는 분과 주소는 화면에 보이는 그대로 함께 기록합니다.',
      stockLine,
      `${closes ? '남은 출고지가 없어 교환이 끝납니다.' : '남은 출고지를 모두 재출고하면 교환이 끝납니다.'} 고객에게 재출고 알림이 가고 운송장이 주문 상세에 보입니다.`,
      '등록한 뒤에는 되돌릴 수 없습니다.',
    ].join('\n'),
    confirmLabel: closes ? '재출고 등록하고 교환 종결' : '재출고 등록',
    cancelLabel: '돌아가기',
    destructive: true,
  };
}

/** 주소를 고치거나 재출고를 등록할 수 없는 이유(DB 판정)를 운영자 말로 옮긴다. 주소 보관 때문이면 주소 자리의 글이 이미 말한다(null). */
function blockedReason(context: ContextResponse): string | null {
  const editing = context.command === 'change';
  const cannot = editing ? '고칠 수 없습니다.' : '재출고를 등록할 수 없습니다.';
  switch (context.blocker) {
    case 'not_applicable': return '교환 요청에서만 쓰는 주소입니다.';
    case 'financial_state': return `이미 취소나 환불을 진행한 주문이라 ${cannot}`;
    case 'claim_stage': return editing ? '주소를 고칠 수 있는 단계가 지났습니다.' : '지금 단계에서는 재출고를 등록할 수 없습니다. 새로고침해 처리 상태를 확인해 주세요.';
    case 'collection_started': return '승인해 회수를 시작한 뒤에는 회수지를 고칠 수 없습니다.';
    case 'collection_unknown': return '접수할 때의 회수 방법을 확인할 수 없어 회수지를 고칠 수 없습니다.';
    case 'reshipment_started': return editing ? '교환품을 보내기 시작한 뒤에는 받을 곳을 고칠 수 없습니다.' : '이미 재출고를 등록한 교환입니다. 새로고침해 처리 상태를 확인해 주세요.';
    case 'collection_incomplete': return '회수를 확인한 출고지가 없어 재출고를 등록할 수 없습니다.';
    default: return context.blocker?.startsWith('claim_contact_') ? null : claimContactError('claim_contact_blocked').message;
  }
}

/* 출고지마다 재출고 등록 버튼 하나. 이름이 없는 옛 주문 한 건은 '최종 주소 확인 후 재출고 등록'이고, 회수 확인 전 배송 건에는 '(회수 없이)'가 붙는다. */
function ReshipTargetButtons({ targets, disabled, onOpen }: { targets: readonly ClaimContactReshipTarget[]; disabled: boolean; onOpen: (target: ClaimContactReshipTarget) => void }) {
  return <div className="flex flex-wrap gap-2">
    {targets.map(target => <button className={PRIMARY} data-slot="button" key={targetKey(target)} type="button" disabled={disabled}
      data-claim-reship-target={targetKey(target)} onClick={() => onOpen(target)}>
      {targets.length > 1 || target.originName ? `${targetName(target)} 재출고 등록` : '최종 주소 확인 후 재출고 등록'}{!target.collected ? ' (회수 없이)' : ''}
    </button>)}
  </div>;
}

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

export function ClaimContactOperationPanel({ identity, scope, orderId, claimId, carriers, reshipItems, reshipTargets, remainingTargets, stockDecisionPendingOrigins = [], claimType }: Omit<Props, 'actorId'> & {
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
  /* 재출고 상품 선택창을 연 주문 품목. */
  const [pickerItem, setPickerItem] = useState<string | null>(null);
  const canReship = reshipTargets.length > 0;
  const alive = useRef(true), busy = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const dispatched = useRef<Dispatched | null>(null);
  const dirty = Boolean(context || recovery);

  function clearPrivate() { setContext(null); setDraft(blank()); setReshipTarget(null); setPickerItem(null); dispatched.current = null; setCanRetry(false); }
  function closePrivate() { generation.current++; controller.current?.abort(); clearPrivate(); }
  useEffect(() => {
    alive.current = true; generation.current++;
    const hide = () => { if (document.visibilityState !== 'visible') { generation.current++; controller.current?.abort(); setContext(null); setDraft(blank()); setPickerItem(null); dispatched.current = null; setCanRetry(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; controller.current?.abort(); dispatched.current = null; document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => {
    if (!context?.expiresAt || recovery) return;
    const timeout = window.setTimeout(() => { setContext(null); setDraft(blank()); setPickerItem(null); setError(EXPIRED); }, Math.max(0, Date.parse(context.expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [context?.expiresAt, recovery]);
  useAdminLeaveGuard({ dirty, message: `적은 내용은 저장되지 않고 사라집니다. 저장됐는지 아직 모르는 처리는 이 화면을 다시 열어 [${SAVE_CHECK_LABEL}]으로 확인할 수 있습니다. 이동할까요?` });

  function begin() {
    const ticket = scope.capture(); if (busy.current || !ticket) return null;
    busy.current = true; setPending(true); setError(''); setMessage('');
    const epoch = ++generation.current, abort = new AbortController(); controller.current = abort;
    return { valid: () => alive.current && generation.current === epoch && scope.canApply(ticket),
      options: { signal: abort.signal, expectedIdentity: identity } };
  }
  function end() { busy.current = false; controller.current = null; if (alive.current) setPending(false); }
  function fail(failure: ErrorResponse) {
    /* 저장됐는지 모르는 실패는 낱말 표의 문장으로 말한다. 그 밖의 거절은 받은 문장 그대로다. */
    setError(failure.uncertain ? SAVE_UNKNOWN_MESSAGE : adminGoodsCopy(failure.message));
    if (failure.authChanged) { clearPrivate(); scope.authenticate(null, null); }
    else if (failure.recoveryOnly && !failure.uncertain) clearPrivate();
    // A late error cannot prove the original request did not commit. Keep its
    // metadata until a receipt or an explicit server seal is read back.
  }
  function accept(receipt: OperationReceipt, original: ClaimContactJournal) {
    if (!receiptMatches(receipt, original)) { setError(`불러온 결과가 이 처리와 맞지 않습니다. [${SAVE_CHECK_LABEL}]을 다시 눌러주세요.`); return; }
    try { sessionStorage.removeItem(key); } catch { /* A retained journal can only recover this completed operation. */ }
    setRecovery(null); clearPrivate(); setError('');
    setMessage(receipt.state === 'sealed' ? '그만뒀습니다. 저장된 것은 없습니다. 주소를 다시 불러와 새로 적어 주세요.'
      : receipt.state === 'noop' ? '변경할 내용이 없어 기존 연락처를 유지했습니다.'
        : receipt.command === 'reshipment' ? '재출고를 등록했습니다. 교환품을 받을 곳도 함께 기록했습니다.' : TARGETS[receipt.target].saved);
    router.refresh();
  }
  async function load(target: Target, command: Command, shipment: ClaimContactReshipTarget | null = null) {
    if (recovery || (command === 'reshipment' && (!canReship || !shipment))) return;
    const run = begin(); if (!run) return; clearPrivate();
    try {
      const result = await fetchClaimContactContext({ requestId: crypto.randomUUID(), orderId, claimId, target, command }, run.options);
      if (!run.valid()) return;
      /* 주소를 읽지 못한 것은 저장과 무관하다 — 저장 결과를 묻는 문장 대신 다시 누르라고 말한다. */
      if ('code' in result) { if (result.uncertain) setError(LOAD_FAILED); else fail(result); }
      else {
        setContext(result); setReshipTarget(command === 'reshipment' ? shipment : null);
        setDraft({ ...blank(), recipientName: result.address?.recipientName ?? '', phone: result.address?.phone ?? '', postalCode: result.address?.postalCode.trim() ?? '', address1: result.address?.address1.trim() ?? '', address2: result.address?.address2 ?? '',
          carrier: carriers.find(carrier => carrier.active)?.code ?? '', items: Object.fromEntries(reshipItems.map(item => [item.id, item.currentVariantId])),
          /* 회수 확인 전 배송 건은 회수 없이 보내는 길뿐이다(버튼에 '(회수 없이)'가 붙어 있다). 따로 체크받지 않는다. */
          waiveCollection: command === 'reshipment' && shipment !== null && !shipment.collected && !shipment.waived });
      }
    } catch { if (run.valid()) setError(LOAD_FAILED); }
    finally { end(); }
  }
  async function save(retry = false) {
    if (busy.current || (!retry && recovery) || retry && !dispatched.current) return;
    if (!retry && (!context?.allowed || !context.address || !context.signedContext)) return;
    if (!retry && (!context!.expiresAt || Date.parse(context!.expiresAt) <= Date.now())) { closePrivate(); setError(EXPIRED); return; }
    const operationId = crypto.randomUUID();
    if (!retry && context!.command === 'reshipment') {
      /* 회수 확인 전 배송 건은 회수 생략(사유·근거 사진)으로만 보낼 수 있다. DB가 같은 조건을 다시 확인한다. */
      if (!reshipTarget) { setError('재출고할 배송 건을 다시 골라주세요.'); return; }
      if (!reshipTarget.collected && !reshipTarget.waived && !(reshipTarget.waivable && draft.waiveCollection)) { setError('이 배송 건의 회수 확인이 먼저 필요합니다. 하자·오배송 교환은 회수 없이 재출고할 수 있습니다.'); return; }
      if (draft.waiveCollection && (!claimWaiverReasonValid(draft.waiverReason) || draft.evidence.length < 1)) {
        setError(`회수 생략 사유(${CLAIM_WAIVER_REASON_MIN}~${CLAIM_WAIVER_REASON_MAX}자)와 근거 사진 1장 이상을 남겨주세요.`); return;
      }
      if (uploading) { setError('근거 사진을 올리는 중입니다. 끝난 뒤 다시 눌러주세요.'); return; }
    }
    const targetItems = reshipTarget ? reshipItems.filter(item => reshipTarget.orderItemIds.includes(item.id)) : [];
    /* 계약의 확인 값(고객 확인·회수 전·주소·발송)은 화면이 채운다 — 체크 대신 필수 근거 글과 확인창이 같은 사실을 받는다. */
    const request = retry ? dispatched.current!.request : context!.command === 'change'
      ? normalizeClaimContactChangeRequest({ requestId: crypto.randomUUID(), orderId, claimId, target: context!.target, operationId, signedContext: context!.signedContext,
        contact: { recipientName: draft.recipientName, phone: draft.phone, address2: draft.address2,
          ...(draft.postalCode.trim() !== context!.address!.postalCode.trim() || draft.address1.trim() !== context!.address!.address1.trim() ? { postalCode: draft.postalCode, address1: draft.address1 } : {}) }, agreement: draft.agreement,
        customerConfirmed: true, handoffNotStartedConfirmed: true })
      : normalizeClaimContactReshipmentRequest({ requestId: crypto.randomUUID(), orderId, claimId, operationId, signedContext: context!.signedContext,
        shipmentId: reshipTarget?.shipmentId ?? null, carrier: draft.carrier, trackingNumber: draft.trackingNumber,
        items: targetItems.map(item => ({ orderItemId: item.id, variantId: draft.items[item.id] })),
        collectionWaiver: draft.waiveCollection ? { reason: normalizeClaimWaiverReason(draft.waiverReason), evidenceFileIds: draft.evidence.map(file => file.id) } : null,
        destinationConfirmed: true, dispatchConfirmed: true });
    if (!request) {
      setError(context!.command === 'change' ? '받는 분(50자 이내)·연락처(숫자 8~15자리)·우편번호(5자리)·주소(200자 이내)·고객 합의 근거(2~500자) 가운데 맞지 않는 칸이 있습니다. 고친 뒤 다시 저장해 주세요.'
        : !draft.carrier ? '택배사를 골라 주세요.'
          : !/^[A-Za-z0-9]{8,30}$/u.test(draft.trackingNumber.trim()) ? '재출고 운송장번호는 영문과 숫자 8~30자로 적어 주세요.'
            : '재출고 상품을 다시 골라 주세요.');
      return;
    }
    const command = retry ? dispatched.current!.command : context!.command;
    if (!retry && command === 'reshipment' && reshipTarget) {
      /* 확인창이 떠 있는 동안 탭이 가려지거나(주소를 지운다) 주소 확인 시간이 지나면 보내지 않는다. */
      const epoch = generation.current, expiresAt = context!.expiresAt!;
      const sent = request as ReshipmentRequest, defective = targetItems.filter(item => reshipTarget.defectiveOrderItemIds?.includes(item.id));
      const waivedDispatch = draft.waiveCollection || Boolean(reshipTarget.waived);
      const confirmed = await adminConfirm(claimReshipmentConfirmRequest({
        originName: targetName(reshipTarget), carrierLabel: carriers.find(carrier => carrier.code === sent.carrier)?.label ?? '택배사', trackingNumber: sent.trackingNumber,
        items: targetItems.map((item) => {
          const option = item.options.find(candidate => candidate.id === draft.items[item.id]);
          return { name: item.name, option: option ? optionLabel(option) : '고른 옵션', qty: item.qty };
        }),
        stock: waivedDispatch ? 'waived' : defective.length ? 'defective' : 'restore', defectiveNames: defective.map(item => item.name),
        closes: (remainingTargets ?? reshipTargets.length) === 1,
      }));
      if (!confirmed || !alive.current || generation.current !== epoch) return;
      if (Date.parse(expiresAt) <= Date.now()) { closePrivate(); setError(EXPIRED); return; }
    }
    const journal = retry ? recovery : parseClaimContactJournal({ operationId: request.operationId, orderId, claimId, command,
      target: context!.target, expectedClaimType: context!.claimType, expectedClaimRevision: context!.claimRevision,
      actorId: identity.actorId, sessionId: identity.sessionId, startedAt: new Date().toISOString() });
    if (!journal) { setError('처리 정보를 만들지 못했습니다. [닫기]를 누른 뒤 주소를 다시 불러와 주세요.'); return; }
    const run = begin(); if (!run) return;
    try {
      try { sessionStorage.setItem(key, JSON.stringify(journal)); } catch { setError('브라우저가 저장을 막아 보내지 않았습니다. 시크릿 창이면 일반 창에서 다시 열어 주세요.'); return; }
      dispatched.current = { command, request }; setRecovery(journal); setCanRetry(true);
      const result = command === 'change' ? await changeClaimContact(request, run.options) : await recordClaimReshipmentV2(request, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else if (result.receipt) accept(result.receipt, journal);
      else setError(SAVE_UNKNOWN_MESSAGE);
    } catch { if (run.valid()) setError(SAVE_UNKNOWN_MESSAGE); }
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
      else setMessage(dispatched.current ? `아직 저장되지 않았습니다. [${RETRY_LABEL}]을 누르거나(두 번 저장되지 않습니다), [${SEAL_LABEL}]를 누른 뒤 새로 적어 주세요.`
        : `아직 저장되지 않았습니다. [${SEAL_LABEL}]를 누른 뒤 새로 적어 주세요.`);
    } catch { if (run.valid()) setError(SAVE_UNKNOWN_MESSAGE); }
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
  const defectiveItems = reshipTarget ? targetItems.filter(item => reshipTarget.defectiveOrderItemIds?.includes(item.id)) : [];
  /* 교환을 종결하는지는 등록할 수 있는 배송 건 수가 아니라 아직 재출고하지 않은 대상 전체로 정한다(입고 전 출고지도 남은 대상이다). */
  const lastTarget = (remainingTargets ?? reshipTargets.length) === 1;
  /* 회수 없이 보내는 재출고: 같은 요청에서 회수 생략을 고르거나, 회수 생략을 먼저 결정한 배송 건이다. */
  const waivedDispatch = draft.waiveCollection || Boolean(reshipTarget?.waived);
  const activeCarriers = carriers.filter(carrier => carrier.active);
  const exchangeAddress = claimType !== 'return';
  const blocked = context && !context.allowed ? blockedReason(context) : null;
  const picking = context?.command === 'reshipment' && pickerItem ? targetItems.find(item => item.id === pickerItem) ?? null : null;
  const pickable = picking ? adminClaimReshipSelectableOptions(picking) : [];
  return <section aria-label={exchangeAddress ? '재출고 등록과 주소 고치기' : '회수지 고치기'} className="flex min-w-0 flex-col gap-4 text-sm break-words" data-claim-contact="">
    {reshipTargets.length || stockDecisionPendingOrigins.length ? <div className="flex min-w-0 flex-col gap-2" data-claim-reship-entry="">
      <h3 className={HEADING}>재출고 등록</h3>
      {reshipTargets.length ? <ReshipTargetButtons disabled={pending || Boolean(recovery)} targets={reshipTargets} onOpen={(target) => { void load('reshipment', 'reshipment', target); }} /> : null}
      {reshipTargets.length > 1 ? <p className="text-muted-foreground">출고지마다 따로 재출고합니다.</p> : null}
      {stockDecisionPendingOrigins.length ? <p className="text-muted-foreground" data-claim-stock-decision-pending="">{stockDecisionPendingOrigins.join(' · ')}: 처리 칸의 회수품 재고 처리를 저장하면 재출고를 등록할 수 있습니다.</p> : null}
    </div> : null}
    <div className="flex min-w-0 flex-col gap-2" data-claim-contact-entry="">
      <h3 className={HEADING}>{exchangeAddress ? `${TARGETS.collection.name}·${TARGETS.reshipment.name}` : TARGETS.collection.name}</h3>
      <div className="flex flex-wrap gap-2">
        <button className={OUTLINE} data-slot="button" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('collection', 'change'); }}>{TARGETS.collection.open}</button>
        {exchangeAddress ? <button className={OUTLINE} data-slot="button" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('reshipment', 'change'); }}>{TARGETS.reshipment.open}</button> : null}
      </div>
      <p className={HINT}>{exchangeAddress ? '회수를 시작하기 전, 교환품을 보내기 전까지만 고칠 수 있습니다.' : '회수를 시작하기 전까지만 고칠 수 있습니다.'}</p>
    </div>
    {context ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-private="true">
      <h4 className="font-medium">{context.command === 'reshipment' ? `${reshipTarget ? `${targetName(reshipTarget)} ` : ''}재출고 등록` : `${TARGETS[context.target].name} 고치기`}</h4>
      {context.command === 'reshipment' ? <p className="text-muted-foreground">교환품을 받을 곳입니다. 운송장의 받는 분·주소와 같은지 확인하세요.</p>
        : context.referenceOnly ? <p className="text-muted-foreground">{context.sourceKind === 'seller_intake' ? '처음 접수할 때 받은 주소입니다.' : '원래 주문의 배송지입니다.'}</p> : null}
      {context.address ? <p className="rounded-lg bg-muted/50 px-3 py-2.5">{context.address.recipientName} · {context.address.phone}<br />({context.address.postalCode}) {context.address.address1}<br />{context.address.address2}</p>
        : <p className="text-muted-foreground">{context.piiState === 'purged' ? '주소 원문이 파기되어 표시하지 않습니다.' : context.unavailableReason === 'retention_due' ? '주소 보관기간이 지나 내용을 표시하지 않습니다.' : '현재 주소를 표시할 수 없습니다.'}</p>}
      {blocked ? <p role="status">{blocked}</p> : null}
      {context.allowed && context.address ? <form autoComplete="off" className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
          <legend className="mb-1 font-medium">{context.command === 'change' ? '받는 분·연락처·주소' : '보낸 내용'}</legend>
          {context.command === 'change' ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD}><span className={FIELD_LABEL}>받는 분 <span className={FIELD_LIMIT}>50자 이내</span></span><input autoComplete="off" className="w-full" required value={draft.recipientName} onChange={event => patch({ recipientName: event.target.value })} /></label>
              <label className={FIELD}><span className={FIELD_LABEL}>연락처 <span className={FIELD_LIMIT}>숫자 8~15자리</span></span><input autoComplete="off" className="w-full" inputMode="tel" required value={draft.phone} onChange={event => patch({ phone: event.target.value })} /></label>
            </div>
            <label className={FIELD}><span className={FIELD_LABEL}>우편번호 <span className={FIELD_LIMIT}>5자리</span></span><input autoComplete="off" className="w-full sm:w-40" inputMode="numeric" pattern={draft.postalCode.trim() !== context.address!.postalCode.trim() || draft.address1.trim() !== context.address!.address1.trim() ? "[0-9]{5}" : undefined} maxLength={20} required value={draft.postalCode} onChange={event => patch({ postalCode: event.target.value })} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>기본 주소 <span className={FIELD_LIMIT}>200자 이내</span></span><input autoComplete="off" className="w-full" maxLength={200} required value={draft.address1} onChange={event => patch({ address1: event.target.value })} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>상세주소 <span className={FIELD_LIMIT}>200자 이내</span></span><input autoComplete="off" className="w-full" value={draft.address2} onChange={event => patch({ address2: event.target.value })} /></label>
            <p className={HINT}>우편번호나 기본 주소를 바꿔 배송비가 달라지거나, 배송비를 알 수 없는 주소면 저장되지 않습니다.</p>
            <label className={FIELD}><span className={FIELD_LABEL}>고객 합의 근거 <span className={FIELD_LIMIT}>필수, 2~500자</span></span><textarea className="w-full" required rows={3} value={draft.agreement} onChange={event => patch({ agreement: event.target.value })}
              placeholder="예: 11/26 고객이 전화로 새 주소를 알려 줌" /></label>
            <p className={HINT}>아래 연락처 변경 이력에 남고 운영자만 봅니다. {TARGETS[context.target].handoff}</p>
          </> : <>
            {reshipTarget?.waived ? <AdminNotice tone="warning" title="이 배송 건은 회수 생략을 결정했습니다.">
              사유와 근거 사진은 출고지별 재출고에 있습니다.</AdminNotice>
            : reshipTarget && !reshipTarget.collected ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-claim-collection-waiver="">
              <AdminNotice tone="warning" title="이 배송 건은 아직 회수를 확인하지 않았습니다.">{reshipTarget.waivable
                ? '하자·오배송 교환이라 사유와 근거 사진을 남기고 회수 없이 재출고합니다.' : '회수를 확인한 뒤에 재출고합니다.'}</AdminNotice>
              {reshipTarget.waivable ? <>
                <label className={FIELD}><span className={FIELD_LABEL}>회수 생략 사유 <span className={FIELD_LIMIT}>필수, {CLAIM_WAIVER_REASON_MIN}~{CLAIM_WAIVER_REASON_MAX}자</span></span>
                  <textarea className="w-full" maxLength={CLAIM_WAIVER_REASON_MAX} rows={3} value={draft.waiverReason} onChange={event => patch({ waiverReason: event.target.value })}
                    placeholder="예: 고객 사진으로 인쇄 불량 확인, 회수 없이 같은 옵션 재발송" /></label>
                <label className={FIELD}><span className={FIELD_LABEL}>근거 사진 <span className={FIELD_LIMIT}>필수, 1~{CLAIM_EVIDENCE_MAX_FILES}장 · JPG·PNG·WebP</span></span>
                  <input accept={CLAIM_EVIDENCE_ACCEPT} className="w-full" disabled={uploading || draft.evidence.length >= CLAIM_EVIDENCE_MAX_FILES} multiple type="file"
                    onChange={event => { void addEvidence(event); }} /></label>
                <p className={HINT}>사유와 사진은 출고지별 재출고에 남습니다. 고객에게는 보이지 않습니다.</p>
                {uploading ? <p className="text-muted-foreground" role="status">근거 사진을 올리고 있습니다.</p> : null}
                {draft.evidence.length ? <ul className="flex flex-wrap gap-2" aria-label="올린 근거 사진">{draft.evidence.map((file, index) => <li className="flex items-center gap-1.5" key={file.id}>
                  <a className="underline underline-offset-4" href={claimEvidenceUrl(file.id)} rel="noreferrer" target="_blank">사진 {index + 1}</a>
                  <button className={OUTLINE} data-slot="button" type="button" onClick={() => patch({ evidence: draft.evidence.filter(item => item.id !== file.id) })}>빼기</button>
                </li>)}</ul> : null}
              </> : null}
            </div> : null}
            {targetItems.map((item) => {
              /* 재출고 상품은 고른 옵션을 한 줄로 보이고, 바꿀 수 있는 옵션이 있을 때만 선택창을 연다(화면 규칙 1·2). */
              const chosen = item.options.find(option => option.id === draft.items[item.id]);
              const others = adminClaimReshipSelectableOptions(item).some(option => option.id !== draft.items[item.id]);
              return <div className={FIELD} data-claim-reship-item={item.id} key={item.id}>
                <span className={FIELD_LABEL}>{item.name} · {item.qty}개 재출고 상품</span>
                <p className="rounded-lg bg-muted/50 px-3 py-2">{chosen ? `${optionLabel(chosen)} · ${chosen.code} · 재고 ${chosen.stockQty}개` : '아직 고르지 않았습니다.'}</p>
                {others ? <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" onClick={() => setPickerItem(item.id)}>재출고 상품 고르기</button> : null}
              </div>;
            })}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD}><span className={FIELD_LABEL}>택배사</span><select className="w-full" required value={draft.carrier} onChange={event => patch({ carrier: event.target.value })}><option value="" disabled>택배사 선택</option>{activeCarriers.map(carrier => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}</select></label>
              <label className={FIELD}><span className={FIELD_LABEL}>재출고 운송장번호 <span className={FIELD_LIMIT}>영문과 숫자 8~30자</span></span><input autoComplete="off" className="w-full" required value={draft.trackingNumber} onChange={event => patch({ trackingNumber: event.target.value })} /></label>
            </div>
            {activeCarriers.length ? null : <p className="text-destructive" role="alert">사용 중인 택배사가 없어 재출고를 등록할 수 없습니다. <a className="underline underline-offset-4" href="/admin/settings/carriers" rel="noreferrer" target="_blank">택배사 설정 열기</a></p>}
            <p className="text-muted-foreground">{waivedDispatch
              ? '회수 상품 재고는 복원하지 않고, 보내는 상품의 재고만 줄입니다.'
              : defectiveItems.length
                ? `불량으로 고른 회수 상품(${defectiveItems.map(item => item.name).join(', ')})은 불량 재고에 적고, 나머지 회수 상품의 재고를 되돌립니다. 보내는 상품의 재고는 줄입니다.`
                : '회수한 상품의 재고를 되돌리고, 보내는 상품의 재고를 줄입니다.'}</p>
          </>}
        </fieldset>
        {!recovery ? <button className={`${PRIMARY} w-fit`} data-slot="button" disabled={locked || uploading} type="submit">{context.command === 'change' ? '저장'
          : lastTarget ? '재출고 등록하고 교환 종결' : '이 배송 건 재출고 등록'}</button> : null}
      </form> : null}
      <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" onClick={closePrivate}>닫기</button>
      {picking ? <AdminPickerDialog<ReshipOption>
        emptyText="맞는 옵션이 없습니다."
        excludedNote={pickable.length < picking.options.length ? '재고가 없는 옵션은 목록에서 뺐습니다.' : undefined}
        load={adminPickerLocalLoader(pickable, { textOf: option => `${optionLabel(option)} ${option.code}` })}
        onClose={() => setPickerItem(null)}
        onSelect={(option) => { patch({ items: { ...draft.items, [picking.id]: option.id } }); }}
        rowKey={option => option.id}
        rowView={option => ({ title: optionLabel(option), meta: `${ADMIN_VOCABULARY.optionCode} ${option.code} · 재고 ${option.stockQty}개${option.id === picking.currentVariantId ? ' · 지금 주문한 옵션' : ''}` })}
        searchPlaceholder="옵션 이름이나 옵션 자동코드로 찾기"
        selectedKeys={draft.items[picking.id] ? [draft.items[picking.id]] : undefined}
        title={`${picking.name} 재출고 상품 고르기`}
      /> : null}
    </div> : null}
    {recovery ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-destructive" role="alert">{recovery.command === 'reshipment' ? '재출고 등록' : `${TARGETS[recovery.target].name} 고치기`}가 저장됐는지 먼저 확인해 주세요.</p>
      <p className="text-muted-foreground">누른 시각 {formatOrderDateTime(recovery.startedAt)}</p>
      <div className="flex flex-wrap gap-2">
        <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void check(); }}>{SAVE_CHECK_LABEL}</button>
        {canRetry ? <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(true); }}>{RETRY_LABEL}</button> : null}
        <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void check(true); }}>{SEAL_LABEL}</button>
      </div>
    </div> : null}
    {pending ? <p className="text-muted-foreground" role="status">처리하고 있습니다.</p> : null}
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
  </section>;
}

export function ClaimContactOperations({ actorId, ...props }: Props) {
  return <ClaimContactSession actorId={actorId}>{(identity, scope) => <ClaimContactOperationPanel key={`${props.orderId}:${props.claimId}:${identity.sessionId}`} {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
