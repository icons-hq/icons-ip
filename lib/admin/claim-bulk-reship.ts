import type { AdminClaimBulkReshipClaim, AdminClaimBulkReshipRow } from './claim-bulk';
import type { AdminConfirmRequest } from './confirm';
import { SAVE_CHECK_LABEL } from './goods-template-save';
import { adminGoodsCopy } from './vocabulary';
import {
  normalizeClaimContactReshipmentRequest,
  parseClaimContactJournal,
  type Address,
  type ClaimContactJournal,
  type ContextResponse,
  type ErrorResponse,
  type OperationReceipt,
  type OperationRequest,
  type OperationResponse,
  type ReshipmentRequest,
} from '@/lib/claim-contact/contracts';

/*
 * 교환 재출고 일괄(SHEET-052)의 한 요청 처리 — 화면(ClaimBulkReshipDialog)과 분리한 순수 흐름이다. 브라우저 의존(연락처
 * 경로 호출·탭 저장소·세션 확인)은 deps로 받아, 결제·재고를 움직이는 순서와 실패 처리를 시험으로 고정한다.
 *
 * 규칙(ADR-0041, T11a 판정 그대로):
 * - 배송 건마다 배송 건 단위 재출고 service RPC를 연락처 경로로 부른다. 회수 생략은 상세에서 결정하므로 요청에는 싣지
 *   않는다(collectionWaiver: null). 회수 생략을 이미 결정한 배송 건은 DB가 그 결정대로 회수품을 복원하지 않는다.
 * - 같은 요청의 다음 배송 건은 앞 재출고로 요청 버전이 바뀌어 최종 주소를 다시 받고, 처음 확인한 주소와 같을 때만 보낸다.
 *   처음 확인한 지 10분(확인 시간)이 지나면 보내지 않는다.
 * - 실패·불확실이면 같은 작업 id로 결과를 읽고, 저장되지 않았으면 그 작업을 종료(seal)한다. 종료되면 DB가 거절한 확정 오류
 *   (예: production_incomplete — 교환품 제작 대기, collection_waiver_conflict — 다른 회수 생략 결정)를 그대로 보이고 그
 *   요청의 남은 배송 건은 보내지 않는다. 결과를 끝내 읽지 못하면 요청번호를 남겨 상세의 [저장 결과 확인]으로 넘긴다.
 * - 상세에서 결과를 확인하지 않은 연락처 작업이 남은 요청은 보내지 않는다(요청번호를 덮어쓰지 않는다).
 */

export const CLAIM_BULK_RESHIP_EXPIRED = '최종 주소를 확인한 지 10분이 지났습니다. 주소를 다시 불러와 확인해주세요.';
export const CLAIM_BULK_RESHIP_ADDRESS_CHANGED = '최종 주소가 처음 확인한 것과 달라 보내지 않았습니다. 요청 상세에서 다시 확인해주세요.';
export const CLAIM_BULK_RESHIP_PREVIOUS_FAILED = '앞 출고지의 재출고가 끝나지 않아 보내지 않았습니다. 요청 상세에서 확인해주세요.';
export const CLAIM_BULK_RESHIP_OUTCOME_UNKNOWN = `저장됐는지 확인하지 못했습니다. 요청 상세의 [${SAVE_CHECK_LABEL}]을 눌러 결과를 확인해주세요.`;
export const CLAIM_BULK_RESHIP_AUTH_CHANGED = '로그인 상태가 바뀌어 남은 줄을 보내지 않았습니다. 다시 로그인한 뒤 상세에서 확인해주세요.';
/** 불러오기 단계에서 뺀 요청(XC3): 이 탭에 결과를 확인하지 않은 재출고 작업이 남아 있다. 주소를 열지 않고 보내지도 않는다. */
export const CLAIM_BULK_RESHIP_PENDING_EXCLUDED = `저장됐는지 모르는 재출고가 남아 있어 이 요청은 뺐습니다. 요청 상세의 [${SAVE_CHECK_LABEL}]을 먼저 눌러주세요.`;
export const CLAIM_BULK_RESHIP_PENDING_OPERATION = `저장됐는지 모르는 연락처·재출고가 남아 있어 보내지 않았습니다. 요청 상세의 [${SAVE_CHECK_LABEL}]을 먼저 눌러주세요.`;
const INVALID_ROW = '재출고 정보를 확인하지 못했습니다. 택배사·운송장·상품을 다시 확인해주세요.';
const JOURNAL_UNAVAILABLE = '브라우저가 저장을 막아 보내지 않았습니다. 시크릿 창이면 일반 창에서 다시 열어주세요.';
const NOT_SAVED = '재출고를 등록하지 못했습니다. 요청 상세에서 확인해주세요.';

/** 확인창에서 불러와 운영자가 확인한 최종 주소(요청 하나). */
export interface ClaimBulkReshipContext {
  address: Address;
  signedContext: string;
  expiresAt: string;
  claimRevision: number;
  claimType: ContextResponse['claimType'];
}

export interface ClaimBulkReshipDraft {
  carrier: string;
  trackingNumber: string;
  items: Record<string, string>;
}

export interface ClaimBulkReshipDeps {
  /** 최종 주소를 다시 받는다(연락처 경로). 연결 실패는 null. */
  fetchContext: (claim: AdminClaimBulkReshipClaim) => Promise<ContextResponse | ErrorResponse | null>;
  record: (request: ReshipmentRequest) => Promise<OperationResponse | ErrorResponse | null>;
  readOrSeal: (request: OperationRequest) => Promise<OperationResponse | ErrorResponse | null>;
  /** 로그인 세션이 시작 때와 같은가. */
  canApply: () => boolean;
  now: () => number;
  newId: () => string;
  journalKey: (claim: AdminClaimBulkReshipClaim) => string;
  /** 탭 저장소. 읽기·쓰기가 막히면 던진다. */
  storage: { get: (key: string) => string | null; set: (key: string, value: string) => void; remove: (key: string) => void };
}

export function reshipRowKey(claimId: string, shipmentId: string | null) {
  return `${claimId}:${shipmentId ?? 'order'}`;
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

/**
 * 한 요청의 배송 건을 순서대로 보낸다. 실패하면 그 요청의 남은 배송 건은 보내지 않는다. 로그인 세션이 바뀌면
 * 'auth_lost'를 돌려줘 호출자가 남은 요청도 멈추게 한다.
 */
export async function registerClaimReshipments(
  input: {
    claim: AdminClaimBulkReshipClaim;
    context: ClaimBulkReshipContext;
    drafts: Record<string, ClaimBulkReshipDraft>;
    identity: { actorId: string; sessionId: string };
  },
  deps: ClaimBulkReshipDeps,
  report: { fail: (row: AdminClaimBulkReshipRow, message: string) => void; succeed: (row: AdminClaimBulkReshipRow, message: string) => void },
): Promise<'ok' | 'stopped' | 'auth_lost'> {
  const { claim, context, drafts, identity } = input;
  let signedContext = context.signedContext;
  let claimRevision = context.claimRevision;
  let claimType = context.claimType;
  let stop: string | null = null;
  const journalKey = deps.journalKey(claim);
  let pendingJournal: string | null;
  try { pendingJournal = deps.storage.get(journalKey); } catch { pendingJournal = 'unavailable'; }
  if (pendingJournal !== null) stop = CLAIM_BULK_RESHIP_PENDING_OPERATION;

  for (const [index, row] of claim.rows.entries()) {
    if (stop) { report.fail(row, stop); continue; }
    if (Date.parse(context.expiresAt) <= deps.now()) { stop = CLAIM_BULK_RESHIP_EXPIRED; report.fail(row, stop); continue; }
    if (index > 0) {
      /* 앞 재출고로 요청 버전이 바뀌었다. 최종 주소를 다시 받아 처음 확인한 주소와 같을 때만 이어서 보낸다. */
      const fresh = await deps.fetchContext(claim).catch(() => null);
      if (!deps.canApply()) {
        claim.rows.slice(index).forEach((rest) => report.fail(rest, CLAIM_BULK_RESHIP_AUTH_CHANGED));
        return 'auth_lost';
      }
      if (!fresh || 'code' in fresh) { stop = fresh && 'code' in fresh ? adminGoodsCopy(fresh.message) : CLAIM_BULK_RESHIP_PREVIOUS_FAILED; report.fail(row, stop); continue; }
      if (!fresh.allowed || !fresh.address || !fresh.signedContext || !sameClaimContactAddress(fresh.address, context.address)) {
        stop = CLAIM_BULK_RESHIP_ADDRESS_CHANGED; report.fail(row, stop); continue;
      }
      signedContext = fresh.signedContext; claimRevision = fresh.claimRevision; claimType = fresh.claimType;
    }
    const draft = drafts[reshipRowKey(claim.claimId, row.shipmentId)];
    const operationId = deps.newId();
    const request = draft ? normalizeClaimContactReshipmentRequest({
      requestId: deps.newId(), orderId: claim.orderId, claimId: claim.claimId, operationId, signedContext,
      shipmentId: row.shipmentId, carrier: draft.carrier, trackingNumber: draft.trackingNumber,
      items: row.items.map((item) => ({ orderItemId: item.orderItemId, variantId: draft.items[item.orderItemId] })),
      collectionWaiver: null, destinationConfirmed: true, dispatchConfirmed: true,
    }) : null;
    const journal = parseClaimContactJournal({ operationId, orderId: claim.orderId, claimId: claim.claimId, command: 'reshipment', target: 'reshipment',
      expectedClaimType: claimType, expectedClaimRevision: claimRevision, actorId: identity.actorId, sessionId: identity.sessionId,
      startedAt: new Date(deps.now()).toISOString() });
    if (!request || !journal) { stop = CLAIM_BULK_RESHIP_PREVIOUS_FAILED; report.fail(row, INVALID_ROW); continue; }
    try { deps.storage.set(journalKey, JSON.stringify(journal)); }
    catch { stop = CLAIM_BULK_RESHIP_PREVIOUS_FAILED; report.fail(row, JOURNAL_UNAVAILABLE); continue; }
    const forget = () => { try { deps.storage.remove(journalKey); } catch { /* 남은 요청번호는 상세가 결과를 읽어 정리한다. */ } };
    const saved = `재출고를 등록했습니다(${request.trackingNumber}).`;

    const response = await deps.record(request).catch(() => null);
    if (!deps.canApply()) {
      report.fail(row, CLAIM_BULK_RESHIP_OUTCOME_UNKNOWN);
      claim.rows.slice(index + 1).forEach((rest) => report.fail(rest, CLAIM_BULK_RESHIP_AUTH_CHANGED));
      return 'auth_lost';
    }
    if (response && !('code' in response) && response.receipt && receiptMatches(response.receipt, journal)) {
      forget(); report.succeed(row, saved); continue;
    }
    /* 실패·불확실: 같은 작업 id로 결과를 읽고, 저장되지 않았으면 그 작업을 종료한다. 늦게 도착한 요청이 다시 기록되지 않는다. */
    const settled = await deps.readOrSeal({ requestId: deps.newId(), sealIfAbsent: true, orderId: claim.orderId, claimId: claim.claimId,
      operationId, command: 'reshipment', target: 'reshipment', expectedClaimType: claimType, expectedClaimRevision: claimRevision }).catch(() => null);
    if (settled && !('code' in settled) && settled.receipt && receiptMatches(settled.receipt, journal)) {
      forget(); report.succeed(row, saved); continue;
    }
    stop = CLAIM_BULK_RESHIP_PREVIOUS_FAILED;
    if (settled && !('code' in settled) && settled.receipt?.state === 'sealed') {
      /* 저장되지 않은 것이 확정됐다. DB가 거절한 확정 오류(제작 대기·다른 회수 생략 결정 등)를 그대로 보인다. */
      forget();
      report.fail(row, response && 'code' in response ? adminGoodsCopy(response.message) : NOT_SAVED);
      continue;
    }
    /* 결과를 끝내 읽지 못했다. 요청번호를 남겨 상세가 [저장 결과 확인]을 띄우게 한다. */
    report.fail(row, CLAIM_BULK_RESHIP_OUTCOME_UNKNOWN);
  }
  return stop ? 'stopped' : 'ok';
}

/**
 * 확인창에 적을 요청 하나. 받는 분·주소는 싣지 않는다 — 주소는 이 창이 탭을 가리거나 10분이 지나면 지우는데, 확인창 본문은 운영자가 닫을 때까지
 * 남기 때문이다. 단건 재출고 확인창과 같은 기준이다(claimReshipmentConfirmRequest). 주소는 창의 표에 보이는 그대로 기록된다.
 */
export interface ClaimBulkReshipSummaryClaim {
  reference: string;
  rows: { origin: string; carrierLabel: string; trackingNumber: string; items: { name: string; qty: number }[] }[];
}

const RESHIP_CONFIRM_CLAIM_LIMIT = 8;

/** 재출고 옵션 줄('상품명 · 옵션 · 옵션 자동코드 · 재고 N개')에서 확인창에 필요 없는 재고 수량을 뗀다. */
export function reshipOptionName(label: string) {
  return label.replace(/ · 재고 [\d,]+개$/, '');
}

/**
 * [재출고 등록]을 누르면 뜨는 확인창. 예전의 '주소가 같습니다'·'발송 정보를 확인했습니다' 체크가 말하던 것을 — 출고지마다의
 * 택배사·운송장·상품 — 한 번에 되읽어 주고, 화면에 보이지 않는 결과(재고가 움직이고 교환이 끝난다)를 말한다. 받는 분·주소는 옮겨 적지 않고
 * 창에 보이는 그대로 기록한다고만 말한다(개인정보가 확인창에 남지 않게 한다). 앞의 여덟 요청만 풀어 적고 나머지는 건수로 줄인다(창 안의 표에 모두 있다).
 */
export function claimBulkReshipConfirmation(claims: readonly ClaimBulkReshipSummaryClaim[]): AdminConfirmRequest {
  const rowCount = claims.reduce((sum, claim) => sum + claim.rows.length, 0);
  const lines = claims.slice(0, RESHIP_CONFIRM_CLAIM_LIMIT).flatMap((claim) => [
    claim.reference,
    ...claim.rows.map((row) => `  ${row.origin} → ${row.carrierLabel} ${row.trackingNumber} · ${row.items.map((item) => `${item.name} × ${item.qty}`).join(', ')}`),
  ]);
  if (claims.length > RESHIP_CONFIRM_CLAIM_LIMIT) lines.push(`그 밖에 ${claims.length - RESHIP_CONFIRM_CLAIM_LIMIT}건`);
  return {
    title: `재출고 ${claims.length}건 · 출고지 ${rowCount}곳 등록`,
    message: [
      '택배사·운송장과 보낼 상품이 실제로 보내는 것과 같은지 확인해주세요.',
      '',
      ...lines,
      '',
      '받는 분과 주소는 창에 보이는 그대로 함께 기록합니다.',
      '출고지마다 회수한 상품의 재고를 복원하고 고른 상품으로 재출고합니다. 모든 출고지를 보내면 교환이 끝납니다. 결제금액은 그대로입니다. 등록하면 되돌릴 수 없습니다.',
    ].join('\n'),
    confirmLabel: '재출고 등록',
    cancelLabel: '돌아가기',
  };
}
