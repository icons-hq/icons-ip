import { normalizeClaimTypeAgreement, type ConvertibleClaimType } from '@/lib/orders/claim-type-conversion';
import { ORDER_CLAIM_TYPE_LABELS, type OrderClaimStage, type OrderClaimType } from '@/lib/orders/claims';
import { isUuid } from '@/lib/uuid';
import type { ClaimDefectiveItem } from './defective-stock';
import { normalizeAdminClaimReceivedOn } from './claims';

/**
 * 클레임 일괄 처리(10/27 회의 R8 · 결정 D8).
 *
 * 새 배열 RPC를 만들지 않는다. 선택한 건마다 기존 단건 경로(`admin_decide_order_claim`,
 * 승인이 처리중이 되면 결제사 취소 오케스트레이터)를 그대로 한 건씩 태운다 — 규칙이 한 벌로
 * 남아야 단건 처리와 일괄 처리의 결과가 갈라지지 않는다.
 *
 * 토스 취소 API는 결제(paymentKey) 단건이고 일괄 API가 없다. 같은 결제의 취소를 동시에 보내면
 * 안 되므로 앞 건이 끝난 뒤에 다음 건을 시작한다(전체 직렬 = 주문·결제별 직렬). 한 건에 사전
 * 조회·취소·사후 조회가 최악 8초씩 걸릴 수 있어, 시작한 건이 목록 maxDuration(60초) 안에 끝날 수
 * 없으면 남은 건은 시작하지 않고 '미처리'로 돌려준다. 같은 건을 다시 실행해도 단건 경로의 멱등
 * 처리가 그대로 적용된다.
 */

export const ADMIN_CLAIM_BULK_LIMIT = 50;
/** 다음 건을 시작할 수 있는 마지막 시점(액션 진입부터). 지나면 남은 건은 '미처리'다. */
export const ADMIN_CLAIM_BULK_TIME_BUDGET_MS = 45_000;
/**
 * 시작한 건이 끝나야 하는 시점(액션 진입부터) — 목록 페이지 maxDuration 60초에서 결과 직렬화·
 * 화면 갱신 여유 5초를 뺐다. 함수가 잘리면 서버 액션이 실패해 결과표를 받지 못한다.
 */
export const ADMIN_CLAIM_BULK_DEADLINE_MS = 55_000;
/**
 * 결제사 취소까지 가는 한 건(취소 승인)의 최악 시간: 토스 사전 조회·취소·사후 조회 각 8초 +
 * 결정·정합화 DB. 다음 건은 '경과 + 이 값 ≤ 마감'일 때만 시작한다.
 */
export const ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS = 30_000;
/** DB 결정만 하는 한 건(검토중·거부·반품·교환 승인)의 최악 시간(문장 제한 시간 8초 + 왕복). */
export const ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS = 10_000;
/** 반품↔교환 전환 한 건의 최악 시간. 최신 요청 읽기와 전환 저장, DB 호출이 둘이다. */
export const ADMIN_CLAIM_BULK_CONVERT_ITEM_RESERVE_MS = ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS * 2;

/** 목록 일괄 전환을 일괄 결정과 구분하는 값. 화면이 어느 서버 액션을 부를지 이 값으로 고른다. */
export const ADMIN_CLAIM_BULK_CONVERT = 'convert';

export const ADMIN_CLAIM_BULK_DECISIONS = ['approve', 'reject', 'review'] as const;
export type AdminClaimBulkDecision = (typeof ADMIN_CLAIM_BULK_DECISIONS)[number];

export const ADMIN_CLAIM_BULK_ACTION_LABELS: Record<AdminClaimBulkDecision, string> = {
  approve: '선택 건 승인',
  reject: '선택 건 거부',
  review: '선택 건 검토중',
};

/**
 * 건별 결과. 'skipped'는 시간 예산으로 시작하지 않은 건(다시 실행), 'excluded'는 그 단계를 쓸 수 없어 처리하지
 * 않은 건(무통장·가상계좌·회수 미완료 등 — 결과표에 사유)이다.
 */
export type AdminClaimBulkOutcome = 'done' | 'failed' | 'skipped' | 'excluded';

export const ADMIN_CLAIM_BULK_OUTCOME_LABELS: Record<AdminClaimBulkOutcome, string> = {
  done: '처리됨',
  failed: '실패',
  skipped: '미처리',
  excluded: '제외',
};

export interface AdminClaimBulkResult {
  claimId: string;
  /** 요청번호(C00012). 요청을 찾지 못했으면 null이다. */
  reference: string | null;
  /** 한 요청 안의 처리 단위(재출고는 출고지 이름). 없으면 요청 전체다. */
  scope?: string | null;
  outcome: AdminClaimBulkOutcome;
  message: string;
}

export interface AdminClaimBulkState {
  error?: string;
  summary?: string;
  results?: AdminClaimBulkResult[];
}

const BULK_FAILED = '클레임을 처리하지 못했습니다. 최신 상태를 확인해주세요.';
const BULK_SKIPPED = '처리 시간이 길어 처리하지 않았습니다. 다시 실행하세요.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 일괄 선택을 열어 둘 단계. 버튼 셋(승인·거부·검토중) 중 하나라도 될 수 있는 단계다.
 *
 * 건별 가능 여부는 여기서 정하지 않는다 — 보류 건의 거부 가능 여부(held_from)처럼 목록 행에
 * 없는 값이 있어서다. DB가 단계 전제조건으로 다시 판정하고, 안 되는 건은 결과표에 사유로 남는다.
 */
export function adminClaimBulkSelectable(claimType: OrderClaimType, stage: OrderClaimStage) {
  if (stage === 'requested' || stage === 'in_review' || stage === 'on_hold') return true;
  if (claimType !== 'cancel' && (stage === 'collecting' || stage === 'collected')) return true;
  /* 환불 완료 확정(1027T-033)은 처리중·결제확인필요 건에도 쓴다. 교환에는 환불이 없다. */
  return claimType !== 'exchange' && (stage === 'processing' || stage === 'needs_review');
}

export function adminClaimBulkConfirmation(
  claimType: OrderClaimType,
  decision: AdminClaimBulkDecision,
  count: number,
) {
  if (decision === 'approve') {
    return claimType === 'cancel'
      ? `선택한 ${count}건의 취소를 승인할까요? 한 건씩 순서대로 처리하며, 토스 결제는 승인하는 즉시 토스 전액 취소를 발행합니다. 되돌릴 수 없습니다.`
      : `선택한 ${count}건을 승인하고 수거를 시작할까요?`;
  }
  if (decision === 'reject') return `선택한 ${count}건을 거부할까요? 입력한 거부 사유가 구매자에게 전달됩니다.`;
  return `선택한 ${count}건을 검토중으로 표시할까요?`;
}

export function adminClaimBulkTimeoutMessage(count: number) {
  return `처리 시간이 길어 ${count}건은 처리하지 않았습니다. 다시 실행하세요.`;
}

export function adminClaimBulkSummary(outcomes: AdminClaimBulkOutcome[]) {
  const count = (outcome: AdminClaimBulkOutcome) => outcomes.filter((value) => value === outcome).length;
  const skipped = count('skipped');
  const excluded = count('excluded');
  const base = `처리됨 ${count('done')}건 · 실패 ${count('failed')}건${excluded > 0 ? ` · 제외 ${excluded}건` : ''}`;
  return skipped > 0 ? `${base} · ${adminClaimBulkTimeoutMessage(skipped)}` : base;
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readClaimIds(formData: FormData): { ok: true; claimIds: string[] } | { ok: false; error: string } {
  const claimIds: string[] = [];
  for (const raw of formData.getAll('claimIds')) {
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(id)) {
      return { ok: false, error: '선택한 요청을 확인하지 못했습니다. 새로고침한 뒤 다시 선택해주세요.' };
    }
    if (!claimIds.includes(id)) claimIds.push(id);
  }
  if (claimIds.length === 0) return { ok: false, error: '처리할 요청을 선택해주세요.' };
  if (claimIds.length > ADMIN_CLAIM_BULK_LIMIT) {
    return { ok: false, error: `한 번에 ${ADMIN_CLAIM_BULK_LIMIT}건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.` };
  }
  return { ok: true, claimIds };
}

export function normalizeAdminClaimBulkForm(
  formData: FormData,
):
  | { ok: true; value: { claimIds: string[]; decision: AdminClaimBulkDecision; note: string | null } }
  | { ok: false; error: string } {
  const ids = readClaimIds(formData);
  if (!ids.ok) return ids;
  const { claimIds } = ids;

  const decision = readString(formData, 'decision');
  if (!(ADMIN_CLAIM_BULK_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: '처리할 작업을 선택해주세요.' };
  }

  if (decision !== 'reject') return { ok: true, value: { claimIds, decision: decision as AdminClaimBulkDecision, note: null } };

  /* DB(private.decide_order_claim)는 앞뒤 공백이 있거나 10~200자 밖이면 거절한다. */
  const note = readString(formData, 'note');
  if (note.length < 10 || note.length > 200) {
    return { ok: false, error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' };
  }
  return { ok: true, value: { claimIds, decision: 'reject', note } };
}

/* 반품↔교환 일괄 전환(10/27 회의 14:52 · MD-0032·0033). 단건 전환과 같은 RPC를 건별로 탄다. */
export function adminClaimBulkConversionTarget(fromType: ConvertibleClaimType): ConvertibleClaimType {
  return fromType === 'return' ? 'exchange' : 'return';
}

export function adminClaimBulkConversionLabel(fromType: ConvertibleClaimType) {
  return `선택 건 ${ORDER_CLAIM_TYPE_LABELS[adminClaimBulkConversionTarget(fromType)]} 전환`;
}

/** 일괄 전환 입력을 확인한다. 화면의 사전 확인과 서버 액션이 같은 규칙을 쓴다. */
export function normalizeAdminClaimBulkConversionForm(
  formData: FormData,
):
  | { ok: true; value: { claimIds: string[]; fromType: ConvertibleClaimType; agreement: string } }
  | { ok: false; error: string } {
  const fromType = readString(formData, 'claimType');
  if (fromType !== 'return' && fromType !== 'exchange') return { ok: false, error: '반품과 교환 요청만 서로 전환할 수 있습니다.' };
  const ids = readClaimIds(formData);
  if (!ids.ok) return ids;
  const agreement = normalizeClaimTypeAgreement(formData.get('agreement'));
  if (agreement === null) return { ok: false, error: '고객 합의 근거를 2자 이상 500자 이하로 입력해주세요.' };
  if (formData.get('confirmed') !== 'true') return { ok: false, error: '선택한 건 모두 고객과 합의했는지 확인해주세요.' };
  return { ok: true, value: { claimIds: ids.claimIds, fromType, agreement } };
}

/**
 * 선택한 건을 한 건씩 순서대로 처리한다. 앞 건이 끝나기 전에 다음 건을 시작하지 않는다.
 *
 * 시간은 다음 건을 **시작하기 전**에 본다. 이미 시작한 건은 끝까지 기다린다 — 결제사 취소를
 * 중간에 버리면 결과를 모르는 취소가 남는다. 그래서 시작 조건에 그 건의 최악 시간을 넣는다:
 * 경과 < 예산(45초)이고 경과 + 최악 시간 ≤ 마감(55초)일 때만 시작한다. 시계는 `startedAt`(액션
 * 진입 시점)부터 잰다 — 인증·폼 확인·요청 조회도 같은 함수 시간 안에서 쓴다. 한 건이 미처리가
 * 되면 남은 건도 시작하지 않는다(선택 순서를 건너뛰어 처리하지 않는다).
 */
export async function runAdminClaimBulkSequentially<T>(
  items: readonly T[],
  /** excluded는 그 단계를 쓸 수 없어 손대지 않은 건이다(결과표에 '제외'와 사유). */
  worker: (item: T) => Promise<{ ok: boolean; message: string; excluded?: boolean }>,
  options: {
    budgetMs?: number;
    deadlineMs?: number;
    /** 한 건의 최악 시간. 생략하면 결제사 취소까지 가는 건(가장 긴 경우)으로 본다. */
    reserveMs?: number | ((item: T) => number);
    /** 액션 진입 시점(clock 기준). 생략하면 지금부터 잰다. */
    startedAt?: number;
    clock?: () => number;
  } = {},
): Promise<{ item: T; outcome: AdminClaimBulkOutcome; message: string }[]> {
  const clock = options.clock ?? Date.now;
  const budget = options.budgetMs ?? ADMIN_CLAIM_BULK_TIME_BUDGET_MS;
  const deadline = options.deadlineMs ?? ADMIN_CLAIM_BULK_DEADLINE_MS;
  const reserve = options.reserveMs ?? ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS;
  const reserveOf = typeof reserve === 'function' ? reserve : () => reserve;
  const started = options.startedAt ?? clock();
  const results: { item: T; outcome: AdminClaimBulkOutcome; message: string }[] = [];
  let exhausted = false;

  for (const item of items) {
    if (!exhausted) {
      const elapsed = clock() - started;
      exhausted = elapsed >= budget || elapsed + reserveOf(item) > deadline;
    }
    if (exhausted) {
      results.push({ item, outcome: 'skipped', message: BULK_SKIPPED });
      continue;
    }
    try {
      const result = await worker(item);
      results.push({ item, outcome: result.excluded ? 'excluded' : result.ok ? 'done' : 'failed', message: result.message });
    } catch {
      results.push({ item, outcome: 'failed', message: BULK_FAILED });
    }
  }
  return results;
}

/**
 * 일괄 버튼을 눌렀을 때 보낼지 정한다(화면 쪽 사전 확인). 서버가 같은 규칙으로 다시 검사한다.
 * 확인 창은 누른 작업의 문구로 한 번만 띄운다.
 */
export function planAdminClaimBulkSubmit(
  input: { claimType: OrderClaimType; count: number; decision: string | null; note: string },
  confirm: (message: string) => boolean,
):
  | { kind: 'invalid'; error: string }
  | { kind: 'dismissed' }
  | { kind: 'submit'; decision: AdminClaimBulkDecision } {
  if (input.count <= 0) return { kind: 'invalid', error: '처리할 요청을 선택해주세요.' };
  if (input.count > ADMIN_CLAIM_BULK_LIMIT) {
    return { kind: 'invalid', error: `한 번에 ${ADMIN_CLAIM_BULK_LIMIT}건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.` };
  }
  if (!input.decision || !(ADMIN_CLAIM_BULK_DECISIONS as readonly string[]).includes(input.decision)) {
    return { kind: 'invalid', error: '처리할 작업을 선택해주세요.' };
  }
  const decision = input.decision as AdminClaimBulkDecision;
  if (decision === 'reject') {
    const note = input.note.trim();
    if (note.length < 10 || note.length > 200) return { kind: 'invalid', error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' };
  }
  return confirm(adminClaimBulkConfirmation(input.claimType, decision, input.count))
    ? { kind: 'submit', decision }
    : { kind: 'dismissed' };
}

/* ===========================================================================
 * 단계 일괄 처리 — 회수 확인·환불 완료 확정·재출고(1027T-033·SHEET-049·SHEET-052)
 *
 * 2026-11-11 사용자 결정(원문): "회수·환불·재출고 일괄 (Recommended)" — "선택 건에 회수 확인·환불 완료 확정(건별
 * 순차 결제 취소)·교환 재출고(행별 택배사·송장) 일괄, 확인창에 건수·환불 합계, 무통장·가상계좌는 제외 사유 표시."
 *
 * 승인·거부와 같은 원칙이다. 쓰기 RPC를 새로 만들지 않고 건마다 단건 경로를 그대로 태운다. 회수 확인은 출고지별
 * 회수 확인(실제 입고일), 환불 완료 확정은 단건 [환불 접수]·[환불 완료 확정] 액션(결제사 취소 오케스트레이터 →
 * finalizer), 재출고는 배송 건 단위 service RPC(최종 주소 10분 결속)다. 확인창의 건수·환불 합계와 제외 사유는
 * 서버가 읽기 RPC(admin_order_claim_bulk_context)로 계산하고, 실행 직전에 건마다 다시 읽어 확인한 금액과 다르면
 * 처리하지 않는다. 결제사 취소는 되돌릴 수 없으므로 일부가 실패해도 나머지를 되돌리지 않고 건별 결과로 보인다.
 * ======================================================================== */

export const ADMIN_CLAIM_BULK_STEPS = ['collect', 'refund', 'reship'] as const;
export type AdminClaimBulkStep = (typeof ADMIN_CLAIM_BULK_STEPS)[number];

export const ADMIN_CLAIM_BULK_STEP_LABELS: Record<AdminClaimBulkStep, string> = {
  collect: '선택 건 회수 확인',
  refund: '선택 건 환불 완료 확정',
  reship: '선택 건 재출고',
};

/** 목록마다 쓰는 단계. 취소에는 회수가, 교환에는 환불이 없다. */
export function adminClaimBulkSteps(claimType: OrderClaimType): readonly AdminClaimBulkStep[] {
  if (claimType === 'cancel') return ['refund'];
  if (claimType === 'return') return ['collect', 'refund'];
  return ['collect', 'reship'];
}

/** 목록 메뉴설명의 일괄 처리 안내. 유형마다 쓰는 단계와 상세로 보내는 처리가 다르다. */
export function adminClaimBulkGuideText(claimType: OrderClaimType) {
  const steps = claimType === 'cancel' ? '환불 완료 확정을' : claimType === 'return' ? '회수 확인·환불 완료 확정을' : '회수 확인·재출고를';
  const limit = claimType === 'exchange' ? `최대 ${ADMIN_CLAIM_BULK_LIMIT}건, 재출고는 ${ADMIN_CLAIM_BULK_RESHIP_LIMIT}건` : `최대 ${ADMIN_CLAIM_BULK_LIMIT}건`;
  const parts = [
    `여러 건을 선택하면 아래에 처리 막대가 뜨고 승인·검토중·거부와 ${steps} 한 번에 처리합니다(${limit}).`,
    '결제사 취소가 겹치지 않게 한 건씩 순서대로 처리하고, 건별 결과를 표로 보여 줍니다.',
  ];
  if (claimType !== 'exchange') parts.push('환불 완료 확정은 확인창에 처리 건수와 환불 합계를 먼저 보이고, 무통장·가상계좌·코페이 결제처럼 결제사 취소로 끝낼 수 없는 건은 사유와 함께 뺍니다.');
  if (claimType !== 'cancel') {
    parts.push(
      '회수 확인은 실제 입고일과 근거를 한 번 입력해 고른 출고지에 함께 남깁니다.',
      '반품·교환 전환도 처리 막대에서 고객 합의 근거를 한 번 입력해 한 번에 처리합니다.',
      '회수 없이 재출고와 환불계좌를 새로 받아야 하는 무통장 건의 전환은 상세에서 한 건씩 처리합니다.',
    );
  }
  return parts.join(' ');
}

export function isAdminClaimBulkStep(value: unknown): value is AdminClaimBulkStep {
  return typeof value === 'string' && (ADMIN_CLAIM_BULK_STEPS as readonly string[]).includes(value);
}

/** 재출고 일괄은 여러 고객의 최종 주소를 한 화면에 연다. 노출 범위와 10분 확인 시간을 줄이려 20건으로 묶는다. */
export const ADMIN_CLAIM_BULK_RESHIP_LIMIT = 20;
/** 환불 완료 확정 한 건의 최악 시간: 환불 접수(DB) + 결제사 사전 조회·취소·사후 조회 + 정합화·원장. */
export const ADMIN_CLAIM_BULK_REFUND_ITEM_RESERVE_MS = ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS + ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS;

/** 서버가 읽은 출고지(배송 건) 회수 사실. */
export interface AdminClaimBulkCollection {
  shipmentId: string;
  originName: string;
  collectedAt: string | null;
  receivedOn: string | null;
  /** 회수 생략(ADR-0041)으로 이미 재출고한 배송 건. */
  waived: boolean;
  returnAddressReady: boolean;
}

/** 단계 일괄 처리가 읽는 한 요청의 사실(admin_order_claim_bulk_context). */
export interface AdminClaimBulkContext {
  claimId: string;
  reference: number;
  orderId: string;
  claimType: OrderClaimType;
  stage: OrderClaimStage;
  collectionPolicy: 'origin' | 'legacy' | null;
  collectionRequired: boolean;
  collections: AdminClaimBulkCollection[];
  paymentProvider: string | null;
  /** 결제사에 취소를 발행할 금액(환불 원장 금액, 원장이 없으면 결제 금액 − 반품배송비 차감 판정). 결제가 없으면 null이다. */
  refundAmount: number | null;
  /** 반품배송비 차감액(ADR-0031). 차감하지 않으면 null — 확인창은 지금 그대로다. */
  refundDeductionAmount?: number | null;
  /** 환불 일괄에서 뺄 사유 코드. null이면 결제사 취소로 확정할 수 있다. */
  refundBlocker: string | null;
}

const CONTEXT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLAIM_TYPES = new Set<string>(['cancel', 'return', 'exchange']);
const CLAIM_STAGES = new Set<string>(['requested', 'in_review', 'collecting', 'collected', 'on_hold', 'processing', 'needs_review', 'completed', 'rejected', 'withdrawn']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableText(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : typeof value === 'string' ? value : undefined;
}

/** RPC 응답을 좁힌다. 모양이 하나라도 어긋나면 null — 확인창에 지어낸 값을 보이지 않는다. */
export function parseAdminClaimBulkContexts(value: unknown): AdminClaimBulkContext[] | null {
  if (!Array.isArray(value)) return null;
  const contexts: AdminClaimBulkContext[] = [];
  for (const row of value) {
    if (!record(row) || typeof row.claimId !== 'string' || !CONTEXT_UUID.test(row.claimId)
      || typeof row.orderId !== 'string' || !CONTEXT_UUID.test(row.orderId)
      || typeof row.claimType !== 'string' || !CLAIM_TYPES.has(row.claimType)
      || typeof row.stage !== 'string' || !CLAIM_STAGES.has(row.stage)
      || !Array.isArray(row.collections)) return null;
    const reference = Number(row.reference);
    const refundAmount = row.refundAmount === null || row.refundAmount === undefined ? null : Number(row.refundAmount);
    const paymentProvider = nullableText(row.paymentProvider);
    const refundBlocker = nullableText(row.refundBlocker);
    if (!Number.isSafeInteger(reference) || reference <= 0 || paymentProvider === undefined || refundBlocker === undefined
      || (refundAmount !== null && (!Number.isSafeInteger(refundAmount) || refundAmount < 0))) return null;
    const collections: AdminClaimBulkCollection[] = [];
    for (const collection of row.collections) {
      const collectedAt = record(collection) ? nullableText(collection.collectedAt) : undefined;
      const receivedOn = record(collection) ? nullableText(collection.receivedOn) : undefined;
      if (!record(collection) || typeof collection.shipmentId !== 'string' || !CONTEXT_UUID.test(collection.shipmentId)
        || typeof collection.originName !== 'string' || collectedAt === undefined || receivedOn === undefined) return null;
      collections.push({
        shipmentId: collection.shipmentId, originName: collection.originName, collectedAt, receivedOn,
        waived: collection.waived === true, returnAddressReady: collection.returnAddressReady === true,
      });
    }
    const deduction = record(row.refundDeduction) && row.refundDeduction.applicable === true
      && typeof row.refundDeduction.deductionAmount === 'number' && Number.isSafeInteger(row.refundDeduction.deductionAmount)
      && row.refundDeduction.deductionAmount > 0
      ? row.refundDeduction.deductionAmount
      : null;
    contexts.push({
      ...(deduction !== null ? { refundDeductionAmount: deduction } : {}),
      claimId: row.claimId,
      reference,
      orderId: row.orderId,
      claimType: row.claimType as OrderClaimType,
      stage: row.stage as OrderClaimStage,
      collectionPolicy: row.collectionPolicy === 'origin' || row.collectionPolicy === 'legacy' ? row.collectionPolicy : null,
      collectionRequired: row.collectionRequired === true,
      collections,
      paymentProvider,
      refundAmount,
      refundBlocker,
    });
  }
  return contexts;
}

/* ---- 회수 확인 ------------------------------------------------------------- */

/** 이번에 회수 확인할 출고지 하나. 레거시 회수(출고지별 회수 이전 요청)는 shipmentId가 null인 요청 전체다. */
export interface AdminClaimBulkCollectTarget {
  shipmentId: string | null;
  originName: string | null;
}

export interface AdminClaimBulkCollectPlan {
  targets: AdminClaimBulkCollectTarget[];
  /** 남은 출고지 가운데 일괄에서 뺀 것과 그 사유. */
  skipped: { originName: string; reason: string }[];
  /** 요청 전체를 뺄 사유. null이면 targets를 처리한다. */
  blocker: string | null;
}

/* 출고지별 회수 확인 RPC가 받는 단계와 같다(admin_record_order_claim_origin_collection). */
const ORIGIN_COLLECTABLE_STAGES = new Set<OrderClaimStage>(['collecting', 'collected', 'processing', 'needs_review']);
export const ADMIN_CLAIM_BULK_WAIVED_ORIGIN_REASON = '회수 생략으로 결정한 출고지입니다. 늦게 도착했으면 요청이 열려 있는 동안 상세에서 입고를 확인해주세요(재고는 바뀌지 않습니다).';
export const ADMIN_CLAIM_BULK_RETURN_ADDRESS_REASON = '출고지 설정에 반송 주소가 없습니다. 등록한 뒤 확인해주세요.';

function collectBlocked(reason: string): AdminClaimBulkCollectPlan {
  return { targets: [], skipped: [], blocker: reason };
}

/** 한 요청에서 일괄 회수 확인할 출고지. 서버가 실행 직전에 같은 판정을 다시 하고, 최종 판정은 RPC다. */
export function adminClaimBulkCollectPlan(context: AdminClaimBulkContext): AdminClaimBulkCollectPlan {
  if (context.claimType === 'cancel') return collectBlocked('취소 요청에는 회수 확인이 없습니다.');
  if (context.stage === 'on_hold') return collectBlocked('보류 중인 요청입니다. 보류를 해제한 뒤 회수를 확인해주세요.');
  if (context.stage === 'requested' || context.stage === 'in_review') return collectBlocked('승인 전 요청입니다. 승인한 뒤 회수를 확인해주세요.');
  if (context.stage === 'completed' || context.stage === 'rejected' || context.stage === 'withdrawn') return collectBlocked('종결된 요청입니다.');
  if (context.collectionPolicy === 'legacy') {
    return context.stage === 'collecting'
      ? { targets: [{ shipmentId: null, originName: null }], skipped: [], blocker: null }
      : collectBlocked('회수 확인이 이미 끝났습니다.');
  }
  if (context.collectionPolicy !== 'origin') return collectBlocked('회수 확인 기준을 읽지 못했습니다. 상세에서 확인해주세요.');
  if (!context.collectionRequired) return collectBlocked('회수가 필요하지 않은 요청입니다.');
  if (!ORIGIN_COLLECTABLE_STAGES.has(context.stage)) return collectBlocked('회수를 확인할 수 있는 단계가 아닙니다.');
  const targets: AdminClaimBulkCollectTarget[] = [];
  const skipped: AdminClaimBulkCollectPlan['skipped'] = [];
  for (const collection of context.collections) {
    if (collection.collectedAt !== null) continue;
    if (collection.waived) skipped.push({ originName: collection.originName, reason: ADMIN_CLAIM_BULK_WAIVED_ORIGIN_REASON });
    else if (!collection.returnAddressReady) skipped.push({ originName: collection.originName, reason: ADMIN_CLAIM_BULK_RETURN_ADDRESS_REASON });
    else targets.push({ shipmentId: collection.shipmentId, originName: collection.originName });
  }
  if (targets.length > 0) return { targets, skipped, blocker: null };
  return { targets, skipped, blocker: skipped.length > 0 ? skipped.map((entry) => `${entry.originName}: ${entry.reason}`).join(' ') : '모든 출고지의 회수 확인이 이미 끝났습니다.' };
}

export function adminClaimBulkCollectTargetLabel(target: AdminClaimBulkCollectTarget) {
  return target.originName ?? '주문 전체';
}

/* ---- 환불 완료 확정 -------------------------------------------------------- */

/** 환불 일괄에서 뺀 사유 코드(admin_order_claim_bulk_context.refundBlocker) → 운영자 문구. */
export const ADMIN_CLAIM_BULK_REFUND_BLOCKERS: Record<string, string> = {
  exchange_has_no_refund: '교환에는 환불이 없습니다.',
  claim_on_hold: '보류 중인 요청입니다. 보류를 해제한 뒤 처리해주세요.',
  claim_not_approved: '승인 전 요청입니다. 승인과 회수 확인 뒤에 환불을 확정합니다.',
  claim_closed: '거부·철회로 종결된 요청입니다.',
  refund_completed: '이미 환불 완료가 기록된 요청입니다.',
  refund_record_only: '이미 종결된 요청입니다. 환불 완료 기록만 남았으면 상세에서 기록해주세요.',
  claim_collections_incomplete: '모든 출고지의 회수 확인이 끝나지 않았습니다. 회수를 먼저 확인해주세요.',
  payment_missing: '결제 내역이 없는 주문입니다. 주문 통합검색에서 처리 상태를 확인해주세요.',
  bank_transfer: '무통장 입금 결제는 결제사 취소가 없습니다. 상세의 무통장 환불 처리와 환불 송금 대기에서 계좌 송금으로 처리합니다.',
  virtual_account: '가상계좌 결제는 환불계좌가 필요해 결제사 취소를 일괄로 발행하지 않습니다. 상세에서 처리해주세요.',
  korpay: '코페이 결제는 결제사 취소 API가 없습니다. 상세에서 취소 접수 양식으로 접수한 뒤 확정해주세요.',
  provider_unsupported: '자동 취소를 지원하지 않는 결제입니다. 상세에서 확인해주세요.',
  refund_method_bank_transfer: '계좌 송금으로 접수된 환불입니다. 결제사 취소를 발행하지 않습니다. 상세에서 처리해주세요.',
  refund_ledger_missing: '환불 기록이 없는 요청입니다. 상세에서 결제 내역을 확인해주세요.',
  claim_not_refundable: '환불을 확정할 수 있는 단계가 아닙니다.',
};

export function adminClaimBulkRefundBlockerMessage(code: string) {
  return ADMIN_CLAIM_BULK_REFUND_BLOCKERS[code] ?? '환불을 확정할 수 없는 요청입니다. 상세에서 확인해주세요.';
}

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  toss: '토스페이먼츠',
  nicepay: '나이스페이',
  bank_transfer: '무통장 입금',
  korpay: '코페이',
};

export function adminClaimBulkProviderLabel(provider: string | null) {
  return provider ? PAYMENT_PROVIDER_LABELS[provider] ?? provider : '결제 없음';
}

/** 확인창의 환불 행. 금액은 서버가 읽은 값이다. */
export interface AdminClaimBulkRefundRow {
  claimId: string;
  reference: string;
  providerLabel: string;
  amount: number | null;
  /** 반품배송비 차감액(ADR-0031). 금액(amount)은 이미 뺀 값이다. */
  deductionAmount?: number | null;
  /** 반품 품목과 재고 처리 선택(QNA-035). 반품이고 처리할 행일 때만 싣는다 — 없으면 확인창은 선택 칸 없이 지금처럼 전부 복원한다. */
  items?: ClaimDefectiveItem[];
  /** null이면 처리, 아니면 결과표에 남길 제외 사유. */
  blocker: string | null;
}

/** 확인창이 실행에 보내는 불량 품목. 화면에 보이는 값(`고른 값 ?? 저장된 선택`)과 같아야 한다 — 저장된 불량이 조용히 복원으로 바뀌지 않게. */
export function adminClaimBulkDefectiveItemIds(items: readonly ClaimDefectiveItem[], chosen: Readonly<Record<string, boolean>>) {
  return items.filter((item) => chosen[item.orderItemId] ?? item.defective).map((item) => item.orderItemId);
}

export interface AdminClaimBulkRefundTotals {
  count: number;
  amount: number;
  byProvider: { label: string; count: number; amount: number }[];
}

/** 처리할 행의 건수·합계(결제사별). 서버 액션이 계산해 확인창에 넘긴다. */
export function adminClaimBulkRefundTotals(rows: readonly AdminClaimBulkRefundRow[]): AdminClaimBulkRefundTotals {
  const byProvider = new Map<string, { label: string; count: number; amount: number }>();
  let count = 0;
  let amount = 0;
  for (const row of rows) {
    if (row.blocker !== null || row.amount === null) continue;
    count += 1;
    amount += row.amount;
    const entry = byProvider.get(row.providerLabel) ?? { label: row.providerLabel, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += row.amount;
    byProvider.set(row.providerLabel, entry);
  }
  return { count, amount, byProvider: [...byProvider.values()] };
}

/* ---- 화면과 서버 사이의 계약 ---------------------------------------------- */

export interface AdminClaimBulkCollectRow {
  claimId: string;
  reference: string;
  targets: AdminClaimBulkCollectTarget[];
  skipped: { originName: string; reason: string }[];
  blocker: string | null;
}

export type AdminClaimBulkStepPreview =
  | { step: 'collect'; rows: AdminClaimBulkCollectRow[] }
  | { step: 'refund'; rows: AdminClaimBulkRefundRow[]; totals: AdminClaimBulkRefundTotals };

export type AdminClaimBulkStepPreviewState = { preview: AdminClaimBulkStepPreview; error?: undefined } | { error: string; preview?: undefined };

function readIds(value: unknown, limit: number): { ok: true; claimIds: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: '처리할 요청을 선택해주세요.' };
  const claimIds: string[] = [];
  for (const raw of value) {
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(id)) return { ok: false, error: '선택한 요청을 확인하지 못했습니다. 새로고침한 뒤 다시 선택해주세요.' };
    if (!claimIds.includes(id)) claimIds.push(id);
  }
  if (claimIds.length === 0) return { ok: false, error: '처리할 요청을 선택해주세요.' };
  if (claimIds.length > limit) return { ok: false, error: `한 번에 ${limit}건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.` };
  return { ok: true, claimIds };
}

function readClaimTypeValue(value: unknown): OrderClaimType | null {
  return value === 'cancel' || value === 'return' || value === 'exchange' ? value : null;
}

/** 확인창 열기 요청. 단계가 그 목록에서 쓸 수 있는지까지 본다. */
export function normalizeAdminClaimBulkStepPreviewInput(input: unknown):
  | { ok: true; value: { claimType: OrderClaimType; step: AdminClaimBulkStep; claimIds: string[] } }
  | { ok: false; error: string } {
  if (!record(input)) return { ok: false, error: '처리할 작업을 선택해주세요.' };
  const claimType = readClaimTypeValue(input.claimType);
  if (!claimType) return { ok: false, error: '목록을 새로고침한 뒤 다시 실행해주세요.' };
  if (!isAdminClaimBulkStep(input.step) || !adminClaimBulkSteps(claimType).includes(input.step)) return { ok: false, error: '처리할 작업을 선택해주세요.' };
  const ids = readIds(input.claimIds, input.step === 'reship' ? ADMIN_CLAIM_BULK_RESHIP_LIMIT : ADMIN_CLAIM_BULK_LIMIT);
  if (!ids.ok) return ids;
  return { ok: true, value: { claimType, step: input.step, claimIds: ids.claimIds } };
}

/* 단건 회수 확인 근거(normalizeAdminClaimEvidenceForm)와 같은 규칙이다. 줄바꿈·탭 밖의 제어 문자는 받지 않는다. */
function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
}

/**
 * 일괄 회수 확인 실행. 고른 요청마다 확인창에서 본 출고지(shipmentIds, 레거시는 빈 배열)와 공통 입고일·근거를 받는다.
 * 근거는 단건 회수 확인과 같은 규칙(1~500자, 표시할 수 없는 문자 거절)이다.
 */
export function normalizeAdminClaimBulkCollectInput(input: unknown, now: Date = new Date()):
  | { ok: true; value: { claimType: OrderClaimType; receivedOn: string; evidence: string; items: { claimId: string; shipmentIds: string[] }[] } }
  | { ok: false; error: string } {
  if (!record(input) || !Array.isArray(input.items)) return { ok: false, error: '처리할 요청을 선택해주세요.' };
  const claimType = readClaimTypeValue(input.claimType);
  if (claimType !== 'return' && claimType !== 'exchange') return { ok: false, error: '반품과 교환 요청만 회수를 확인합니다.' };
  /* 일괄은 입고일을 비워 둘 수 없다 — 확인창에 보인 날짜가 그대로 기산점이 된다. */
  const receivedOn = normalizeAdminClaimReceivedOn(input.receivedOn, now);
  if (!receivedOn.ok || receivedOn.value === null) return { ok: false, error: '실제 입고일은 오늘이나 그 이전 날짜로 입력해주세요.' };
  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
  if (!evidence || evidence.length > 500) return { ok: false, error: '회수 확인 근거를 500자 이내로 입력해주세요.' };
  if (hasControlCharacter(evidence)) return { ok: false, error: '회수 확인 근거에 표시할 수 없는 문자가 있습니다. 내용을 확인해주세요.' };
  const ids = readIds(input.items.map((item) => (record(item) ? item.claimId : null)), ADMIN_CLAIM_BULK_LIMIT);
  if (!ids.ok) return ids;
  if (ids.claimIds.length !== input.items.length) return { ok: false, error: '같은 요청이 두 번 선택됐습니다. 새로고침한 뒤 다시 선택해주세요.' };
  const items: { claimId: string; shipmentIds: string[] }[] = [];
  for (const [index, raw] of (input.items as Record<string, unknown>[]).entries()) {
    if (!Array.isArray(raw.shipmentIds)) return { ok: false, error: '회수 확인할 출고지를 다시 골라주세요.' };
    const shipmentIds: string[] = [];
    for (const value of raw.shipmentIds) {
      const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!UUID_PATTERN.test(id) || shipmentIds.includes(id)) return { ok: false, error: '회수 확인할 출고지를 다시 골라주세요.' };
      shipmentIds.push(id);
    }
    items.push({ claimId: ids.claimIds[index], shipmentIds });
  }
  return { ok: true, value: { claimType, receivedOn: receivedOn.value, evidence, items } };
}

/** 일괄 환불 완료 확정 실행. 요청마다 확인창에서 본 금액을 함께 받아, 실행 직전 금액과 다르면 처리하지 않는다. */
export function normalizeAdminClaimBulkRefundInput(input: unknown):
  | { ok: true; value: { claimType: OrderClaimType; items: { claimId: string; expectedAmount: number; defectiveItemIds?: string[] }[] } }
  | { ok: false; error: string } {
  if (!record(input) || !Array.isArray(input.items)) return { ok: false, error: '처리할 요청을 선택해주세요.' };
  const claimType = readClaimTypeValue(input.claimType);
  if (claimType !== 'cancel' && claimType !== 'return') return { ok: false, error: '취소와 반품 요청만 환불을 확정합니다.' };
  const ids = readIds(input.items.map((item) => (record(item) ? item.claimId : null)), ADMIN_CLAIM_BULK_LIMIT);
  if (!ids.ok) return ids;
  if (ids.claimIds.length !== input.items.length) return { ok: false, error: '같은 요청이 두 번 선택됐습니다. 새로고침한 뒤 다시 선택해주세요.' };
  const items: { claimId: string; expectedAmount: number; defectiveItemIds?: string[] }[] = [];
  for (const [index, raw] of (input.items as Record<string, unknown>[]).entries()) {
    const expectedAmount = typeof raw.expectedAmount === 'number' ? raw.expectedAmount : Number.NaN;
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0) return { ok: false, error: '확인한 환불 금액을 읽지 못했습니다. 확인창을 다시 열어주세요.' };
    /* 품목별 재고 처리(QNA-035): 배열이 있으면 '선택했다'는 뜻이다(빈 배열 = 전부 판매 재고 복원). 없으면 지금처럼 선택 없이 처리한다. */
    if (raw.defectiveItemIds === undefined) { items.push({ claimId: ids.claimIds[index], expectedAmount }); continue; }
    const defective = Array.isArray(raw.defectiveItemIds) && raw.defectiveItemIds.length <= 200
      ? raw.defectiveItemIds.map((id) => (typeof id === 'string' && isUuid(id) ? id.toLowerCase() : null))
      : null;
    if (!defective || defective.some((id) => id === null) || new Set(defective).size !== defective.length) {
      return { ok: false, error: '불량으로 고른 품목을 읽지 못했습니다. 확인창을 다시 열어주세요.' };
    }
    items.push({ claimId: ids.claimIds[index], expectedAmount, defectiveItemIds: defective as string[] });
  }
  return { ok: true, value: { claimType, items } };
}

/** 미처리(시간 예산) 건을 이어서 보낼지. 한 번에 한 건도 처리하지 못했으면 멈춘다(무한 반복 방지). */
export function adminClaimBulkContinuation<T extends { outcome: AdminClaimBulkOutcome }>(results: readonly T[]) {
  const skipped = results.filter((result) => result.outcome === 'skipped');
  const progressed = results.some((result) => result.outcome !== 'skipped');
  return { skipped, continue: skipped.length > 0 && progressed };
}

/* ---- 재출고 ---------------------------------------------------------------- */

/*
 * 재출고 일괄(SHEET-052)은 (요청 × 배송 건) 한 줄마다 택배사·운송장·재출고 옵션을 받아 배송 건 단위 재출고
 * service RPC를 순서대로 부른다(ADR-0041). 같은 요청의 다음 배송 건은 앞 재출고로 요청 버전이 바뀌므로 최종 주소
 * 확인을 다시 받아(주소가 처음 확인한 것과 같을 때만) 이어서 보낸다. 회수 생략(하자·오배송, 사진 필요)은 상세에서만 한다.
 * 이 목록은 주소를 싣지 않는다 — 주소는 확인창에서 연락처 경로(최종 주소 확인, 10분)로만 연다.
 */
export interface AdminClaimBulkReshipOption {
  id: string;
  label: string;
}

export interface AdminClaimBulkReshipItem {
  orderItemId: string;
  name: string;
  variantName: string | null;
  qty: number;
  /** 기본으로 고를 재출고 옵션(지금 주문 품목의 옵션). */
  currentVariantId: string;
  options: AdminClaimBulkReshipOption[];
}

export interface AdminClaimBulkReshipRow {
  /** 배송 건(출고지). null이면 배송 건 없는 옛 주문 전체다. */
  shipmentId: string | null;
  originName: string | null;
  /** 회수 생략을 이미 결정한 배송 건. 재출고는 그 결정대로 회수품 재고를 복원하지 않는다(요청에 사유·사진을 다시 싣지 않는다). */
  waived: boolean;
  items: AdminClaimBulkReshipItem[];
}

export interface AdminClaimBulkReshipClaim {
  claimId: string;
  orderId: string;
  reference: string;
  rows: AdminClaimBulkReshipRow[];
  /** 일괄에서 뺀 배송 건과 사유(회수 확인 전 — 회수 생략은 상세에서). */
  skipped: { originName: string; reason: string }[];
}

export type AdminClaimBulkReshipLoad =
  | {
    actorId: string;
    carriers: { code: string; label: string }[];
    claims: AdminClaimBulkReshipClaim[];
    excluded: { claimId: string; reference: string | null; reason: string }[];
    error?: undefined;
  }
  | { error: string; actorId?: undefined };

export const ADMIN_CLAIM_BULK_RESHIP_WAIVER_REASON = '회수 확인 전 출고지입니다. 하자·오배송의 회수 없이 재출고는 근거 사진이 필요해 상세에서 처리합니다.';
export const ADMIN_CLAIM_BULK_RESHIP_DECISION_REASON = '주문제작 상품이 있는 회수 확인 전 출고지입니다. 상세에서 회수 생략을 먼저 결정해 교환품 제작을 시작합니다.';
export const ADMIN_CLAIM_BULK_RESHIP_PRODUCTION_REASON = '교환품 제작이 끝나지 않은 출고지입니다. 주문제작 처리에서 제작을 마친 뒤 재출고합니다.';
export const ADMIN_CLAIM_BULK_RESHIP_COLLECTION_REASON = '회수 확인 전 출고지입니다. 회수를 확인한 뒤 재출고합니다.';

/** 한 줄의 재출고 입력. 화면이 보내기 전에 확인하고, 형식은 DB가 다시 본다. */
export function adminClaimBulkReshipRowError(input: { carrier: string; trackingNumber: string; items: readonly { variantId: string }[] }) {
  if (!input.carrier) return '택배사를 골라주세요.';
  if (!/^[A-Z0-9]{8,30}$/.test(input.trackingNumber.trim().toUpperCase())) return '운송장번호는 영문과 숫자 8~30자로 입력해주세요.';
  if (input.items.some((item) => !UUID_PATTERN.test(item.variantId))) return '재출고할 상품을 골라주세요.';
  return null;
}
