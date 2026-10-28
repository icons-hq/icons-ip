import type { OrderClaimStage, OrderClaimType } from '@/lib/orders/claims';

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

export const ADMIN_CLAIM_BULK_DECISIONS = ['approve', 'reject', 'review'] as const;
export type AdminClaimBulkDecision = (typeof ADMIN_CLAIM_BULK_DECISIONS)[number];

export const ADMIN_CLAIM_BULK_ACTION_LABELS: Record<AdminClaimBulkDecision, string> = {
  approve: '선택 건 승인',
  reject: '선택 건 거부',
  review: '선택 건 검토중',
};

export type AdminClaimBulkOutcome = 'done' | 'failed' | 'skipped';

export const ADMIN_CLAIM_BULK_OUTCOME_LABELS: Record<AdminClaimBulkOutcome, string> = {
  done: '처리됨',
  failed: '실패',
  skipped: '미처리',
};

export interface AdminClaimBulkResult {
  claimId: string;
  /** 요청번호(C00012). 요청을 찾지 못했으면 null이다. */
  reference: string | null;
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
  return claimType !== 'cancel' && (stage === 'collecting' || stage === 'collected');
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
  const base = `처리됨 ${count('done')}건 · 실패 ${count('failed')}건`;
  return skipped > 0 ? `${base} · ${adminClaimBulkTimeoutMessage(skipped)}` : base;
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminClaimBulkForm(
  formData: FormData,
):
  | { ok: true; value: { claimIds: string[]; decision: AdminClaimBulkDecision; note: string | null } }
  | { ok: false; error: string } {
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
  worker: (item: T) => Promise<{ ok: boolean; message: string }>,
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
      results.push({ item, outcome: result.ok ? 'done' : 'failed', message: result.message });
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
