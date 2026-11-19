import { isUuid } from '@/lib/uuid';
import { isGoodsShipDate } from '@/lib/goods-preorders';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';

export type GoodsPreorderState = 'draft' | 'active' | 'stopped';
export interface GoodsPreorderInput {
  state: GoodsPreorderState;
  capacityQty: number | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedShipDate: string | null;
  approvalReference: string | null;
}
export interface AdminGoodsPreorder extends GoodsPreorderInput {
  id: string; goodId: string; variantId: string; revision: number; selected: boolean;
  remainingQty: number | null; reservedQty: number; allocatedQty: number;
  createdAt: string; activatedAt: string | null; stoppedAt: string | null;
}
export interface AdminPreorderReservation {
  orderItemId: string; orderId: string; policyId: string; variantId: string; variantName: string | null;
  qty: number; physicalStockQty: number; state: 'reserved' | 'allocated' | 'released' | 'returned';
  orderStatus: 'pending' | 'paid' | 'confirmed' | 'shipping' | 'delivered' | 'done' | 'canceled';
  expectedShipDate: string; createdAt: string; allocatedAt: string | null; allocationReference: string | null;
  releasedAt: string | null; releaseReason: string | null;
  /** 출고 보류(테스트 결제·결제사 취소)로 실재고 할당이 막힌 주문. 선택할 수 없다(옛 응답에는 없다). */
  fulfillmentHold?: boolean;
}
export interface AdminPreorderReservationPage { total: number; items: AdminPreorderReservation[]; hasMore: boolean }
/** 예약 주문 목록 한 페이지 행 수 — 조회 RPC의 `p_limit`(상한 100)과 화면 페이지 이동이 같은 값을 쓴다. */
export const ADMIN_PREORDER_RESERVATION_PAGE_SIZE = 100;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647;
}
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function optionalInstant(value: unknown): string | null | false {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !isGoodsShipDate(value.slice(0, 10))) return false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const date = new Date(`${value}:00+09:00`);
    return Number.isFinite(date.valueOf()) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 ? date.toISOString() : false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number(value.slice(11, 13)) >= 24 || Number(value.slice(14, 16)) >= 60 || Number(value.slice(17, 19)) >= 60 || !timestamp(value)) return false;
  return value;
}
export function parseGoodsPreorderInput(value: unknown): GoodsPreorderInput | null {
  if (!object(value) || !['draft', 'active', 'stopped'].includes(String(value.state))
    || Object.keys(value).some((key) => !['state', 'capacityQty', 'startsAt', 'endsAt', 'expectedShipDate', 'approvalReference'].includes(key))) return null;
  if (value.state === 'stopped') return { state: 'stopped', capacityQty: null, startsAt: null, endsAt: null, expectedShipDate: null, approvalReference: null };
  let capacityQty: number | null = null;
  if (value.capacityQty !== '' && value.capacityQty !== null && value.capacityQty !== undefined) {
    if (typeof value.capacityQty !== 'number' && (typeof value.capacityQty !== 'string' || !/^[1-9]\d*$/.test(value.capacityQty))) return null;
    if (!integer(Number(value.capacityQty), 1)) return null;
    capacityQty = Number(value.capacityQty);
  }
  const startsAt = optionalInstant(value.startsAt);
  const endsAt = optionalInstant(value.endsAt);
  if (startsAt === false || endsAt === false || (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))) return null;
  const expectedShipDate = value.expectedShipDate === '' || value.expectedShipDate == null ? null : value.expectedShipDate;
  if (expectedShipDate !== null && !isGoodsShipDate(expectedShipDate)) return null;
  if (value.approvalReference != null && typeof value.approvalReference !== 'string') return null;
  const approvalReference = typeof value.approvalReference === 'string' ? value.approvalReference.trim() || null : null;
  if (approvalReference && approvalReference.length > 2000) return null;
  if (value.state === 'active') {
    if (capacityQty === null || startsAt === null || endsAt === null || expectedShipDate === null || approvalReference === null) return null;
    const lastSaleDate = new Date(Date.parse(endsAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (expectedShipDate < lastSaleDate) return null;
  }
  return { state: value.state as GoodsPreorderState, capacityQty, startsAt, endsAt, expectedShipDate: expectedShipDate as string | null, approvalReference };
}
/*
 * 예약판매 '적용'(DB state='active')과 '임시저장'(state='draft').
 * 2026-11-19 사고: 운영자가 저장 방식 기본값('초안')으로 저장한 예약 6건이 판매에 적용되지 않았다. 화면은 적용 권한이 있으면
 * 적용을 기본 동작으로 두고, 적용에 필요한 칸이 비면 그 칸 옆에 이유를 보이고 저장을 막는다. 규칙은 DB
 * (admin_save_goods_preorder의 invalid_preorder_policy·preorder_policy_not_configured)와 같다 — DB가 다시 막는다.
 */
/** 적용 권한이 있는 계정의 임시저장 안내(버튼 옆). */
export const PREORDER_DRAFT_NOTE = '임시저장은 판매에 반영되지 않습니다. 예약판매로 팔려면 적용 필수 칸을 채우고 [예약판매 적용]을 눌러주세요.';
/** 적용 권한이 없는 계정의 안내. 이 계정은 임시저장만 할 수 있다. */
export const PREORDER_STAFF_DRAFT_NOTE = '임시저장 — 계정 주매니저·통합 매니저가 적용하기 전까지 판매에 반영되지 않습니다.';
export type PreorderApplyField = 'capacityQty' | 'startsAt' | 'endsAt' | 'expectedShipDate' | 'approvalReference';
export const PREORDER_APPLY_FIELD_LABELS: Record<PreorderApplyField, string> = {
  capacityQty: '승인 예약 물량', startsAt: '접수 시작', endsAt: '접수 종료', expectedShipDate: '발송 예정일', approvalReference: '승인 근거',
};
const PREORDER_APPLY_FIELDS = Object.keys(PREORDER_APPLY_FIELD_LABELS) as PreorderApplyField[];
export interface PreorderApplyValues {
  /** 랜덤 판매는 옵션별 물량을 따로 보므로(preorderCapacityProblem) 공통 칸 검사에서 뺀다(undefined). */
  capacityQty?: string;
  startsAt: string;
  endsAt: string;
  expectedShipDate: string;
  approvalReference: string;
}
export type PreorderApplyProblems = Partial<Record<PreorderApplyField, string>>;

/*
 * 예약 물량 = 재고수량(2026-11-19 "예약상품도 그냥 재고수량 미리 입력할 수 있게"). MD는 옵션 재고수량 하나만 입력하고, 예약 물량 칸은
 * 기본으로 그 값을 따라간다(재고수량을 바꾸면 같이 바뀐다). 직접 고치면 그 값을 쓰고, 재고수량과 다르면 경고만 하고 막지 않는다.
 * DB 장부는 그대로다 — 예약이 선택된 옵션은 예약 물량으로만 팔리고(resolve_goods_variant_supply) 주문이 재고를 깎지 않으며,
 * 입고 확인(admin_allocate_goods_preorders)이 선택 합계 ≤ 실재고일 때 그만큼 재고를 차감한다. 그래서 미리 넣은 재고로 바로 할당한다.
 */
/** 예약 물량 기본값: 그 옵션의 재고수량(1 이상일 때). 0·미입력이면 빈 값이라 직접 입력한다. */
export function preorderCapacityFromStock(stockQty: number | null | undefined): string {
  return typeof stockQty === 'number' && Number.isSafeInteger(stockQty) && stockQty > 0 ? String(stockQty) : '';
}
/** 예약 물량이 재고수량과 다를 때의 안내(막지 않는다). 같거나 물량이 형식에 맞지 않으면 null. */
export function preorderCapacityStockNote(capacity: string, stockQty: number | null | undefined): string | null {
  const qty = capacity.trim();
  if (!/^[1-9]\d*$/.test(qty)) return null;
  const stock = typeof stockQty === 'number' && Number.isSafeInteger(stockQty) && stockQty > 0 ? stockQty : 0;
  if (Number(qty) === stock) return null;
  return stock === 0
    ? '재고수량이 0입니다. 물건이 들어오면 재고 조정으로 입고 수량을 더한 뒤 입고 확인(예약 주문 할당)을 합니다.'
    : `재고수량 ${stock.toLocaleString('ko-KR')}개와 다릅니다. 입고 확인(예약 주문 할당)은 재고수량 안에서만 되므로, 실제 입고 수량과 다르면 재고 조정으로 맞춘 뒤 할당합니다.`;
}

/** 승인 예약 물량 한 칸의 적용 전 확인. 문제가 없으면 null. */
export function preorderCapacityProblem(value: string): string | null {
  const qty = value.trim();
  if (!qty) return '승인 예약 물량을 입력해주세요.';
  return /^[1-9]\d*$/.test(qty) && integer(Number(qty), 1) ? null : '승인 예약 물량은 1 이상의 정수로 입력해주세요.';
}

/** 예약판매 적용 전 칸별 확인. 비었거나 DB가 거절할 값이면 칸 이름을 키로 이유를 돌려준다. 빈 객체면 적용할 수 있다. */
export function preorderApplyProblems(values: PreorderApplyValues, now = Date.now()): PreorderApplyProblems {
  const problems: PreorderApplyProblems = {};
  if (values.capacityQty !== undefined) {
    const capacity = preorderCapacityProblem(values.capacityQty);
    if (capacity) problems.capacityQty = capacity;
  }
  const starts = optionalInstant(values.startsAt), ends = optionalInstant(values.endsAt);
  if (!values.startsAt) problems.startsAt = '접수 시작 일시를 입력해주세요.';
  else if (!starts) problems.startsAt = '접수 시작 일시를 다시 입력해주세요.';
  if (!values.endsAt) problems.endsAt = '접수 종료 일시를 입력해주세요.';
  else if (!ends) problems.endsAt = '접수 종료 일시를 다시 입력해주세요.';
  else if (starts && Date.parse(ends) <= Date.parse(starts)) problems.endsAt = '접수 종료는 접수 시작보다 뒤여야 합니다.';
  else if (Date.parse(ends) <= now) problems.endsAt = '접수 종료는 지금보다 뒤여야 합니다.';
  if (!values.expectedShipDate) problems.expectedShipDate = '발송 예정일을 입력해주세요.';
  else if (!isGoodsShipDate(values.expectedShipDate)) problems.expectedShipDate = '발송 예정일을 다시 입력해주세요.';
  else if (ends && values.expectedShipDate < new Date(Date.parse(ends) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)) {
    problems.expectedShipDate = '발송 예정일은 접수 종료일과 같거나 뒤여야 합니다.';
  }
  const reference = values.approvalReference.trim();
  if (!reference) problems.approvalReference = '승인 문서 번호나 확인 근거를 입력해주세요.';
  else if (reference.length > 2000) problems.approvalReference = '승인 근거는 2,000자까지 입력할 수 있습니다.';
  return problems;
}

/** 문제가 있는 칸 이름을 화면 순서대로 잇는다(예: '승인 예약 물량·접수 종료·승인 근거'). 저장 오류 요약에 쓴다. */
export function preorderApplyProblemLabels(problems: PreorderApplyProblems): string {
  return PREORDER_APPLY_FIELDS.filter((field) => problems[field]).map((field) => PREORDER_APPLY_FIELD_LABELS[field]).join('·');
}

/**
 * 판매에 적용되지 않은 임시저장만 있는 옵션. 임시저장(draft) 조건이 있는데 적용 중(active)인 조건이 없는 옵션이다 — 이 옵션은
 * 실제 재고 기준으로 판매되고 예약 주문을 받지 않는다. `variantIds`를 주면 그 옵션(사용 중인 옵션)만 본다.
 */
export function preorderDraftOnlyVariantIds(policies: readonly Pick<AdminGoodsPreorder, 'variantId' | 'state'>[], variantIds?: readonly string[]): string[] {
  const active = new Set(policies.filter((policy) => policy.state === 'active').map((policy) => policy.variantId));
  const drafts = [...new Set(policies.filter((policy) => policy.state === 'draft' && !active.has(policy.variantId)).map((policy) => policy.variantId))];
  return variantIds ? variantIds.filter((id) => drafts.includes(id)) : drafts;
}

export function parseAdminGoodsPreorders(value: unknown): AdminGoodsPreorder[] | null {
  if (!Array.isArray(value)) return null;
  const result: AdminGoodsPreorder[] = [];
  for (const row of value) {
    if (!object(row) || !isUuid(row.id) || !isUuid(row.variantId) || typeof row.goodId !== 'string' || !row.goodId
      || !['draft', 'active', 'stopped'].includes(String(row.state)) || !integer(row.revision, 1) || typeof row.selected !== 'boolean'
      || !integer(row.reservedQty) || !integer(row.allocatedQty) || !timestamp(row.createdAt)
      || (row.activatedAt !== null && !timestamp(row.activatedAt)) || (row.stoppedAt !== null && !timestamp(row.stoppedAt))) return null;
    const input = parseGoodsPreorderInput({ state: row.state === 'stopped' ? 'active' : row.state, capacityQty: row.capacityQty,
      startsAt: row.startsAt, endsAt: row.endsAt, expectedShipDate: row.expectedShipDate, approvalReference: row.approvalReference });
    if (!input || (input.capacityQty === null ? row.remainingQty !== null : !integer(row.remainingQty)
      || row.remainingQty !== input.capacityQty - row.reservedQty - row.allocatedQty)
      || (row.state !== 'draft' && row.activatedAt === null) || (row.state === 'stopped' && row.stoppedAt === null)
      || (row.state === 'draft' && row.selected)) return null;
    result.push({ ...input, state: row.state as GoodsPreorderState, id: row.id, variantId: row.variantId, goodId: row.goodId,
      revision: row.revision, selected: row.selected, remainingQty: row.remainingQty as number | null,
      reservedQty: row.reservedQty, allocatedQty: row.allocatedQty, createdAt: row.createdAt,
      activatedAt: row.activatedAt as string | null, stoppedAt: row.stoppedAt as string | null });
  }
  return result;
}
export function parseAdminPreorderReservations(value: unknown): AdminPreorderReservationPage | null {
  if (!object(value) || !integer(value.total) || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean') return null;
  const items: AdminPreorderReservation[] = [];
  for (const row of value.items) {
    if (!object(row) || !isUuid(row.orderItemId) || !isUuid(row.orderId) || !isUuid(row.policyId) || !isUuid(row.variantId)
      || !integer(row.qty, 1) || !integer(row.physicalStockQty) || !timestamp(row.createdAt) || !isGoodsShipDate(row.expectedShipDate)
      || (row.variantName !== null && typeof row.variantName !== 'string')
      || !['reserved', 'allocated', 'released', 'returned'].includes(String(row.state))
      || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(row.orderStatus))
      || (row.allocatedAt !== null && !timestamp(row.allocatedAt)) || (row.releasedAt !== null && !timestamp(row.releasedAt))
      || (row.allocationReference !== null && typeof row.allocationReference !== 'string')
      || (row.releaseReason !== null && typeof row.releaseReason !== 'string')
      || (row.fulfillmentHold !== undefined && typeof row.fulfillmentHold !== 'boolean')
      || items.some((item) => item.orderItemId === row.orderItemId)) return null;
    items.push(row as unknown as AdminPreorderReservation);
  }
  return items.length <= value.total ? { total: value.total, items, hasMore: value.hasMore } : null;
}
export function preparePreorderAllocation(rows: readonly Pick<AdminPreorderReservation, 'orderItemId' | 'variantId' | 'physicalStockQty'>[], idsValue: unknown):
  { orderItemIds: string[]; expectedStock: Record<string, number> } | null {
  if (!Array.isArray(idsValue) || !idsValue.length || idsValue.length > 100 || !idsValue.every(isUuid)
    || new Set(idsValue).size !== idsValue.length) return null;
  const expectedStock: Record<string, number> = {};
  for (const id of idsValue) {
    const row = rows.find((item) => item.orderItemId === id);
    if (!row || !isUuid(row.variantId) || !integer(row.physicalStockQty)
      || (Object.hasOwn(expectedStock, row.variantId) && expectedStock[row.variantId] !== row.physicalStockQty)) return null;
    expectedStock[row.variantId] = row.physicalStockQty;
  }
  return { orderItemIds: idsValue, expectedStock };
}

/**
 * 옵션별 미할당 예약 합계(남은 옵션만). 일반 재고 전환(`admin_use_stock_supply`)은 지금 선택된 정책만이 아니라 그 옵션의
 * 모든 예약 정책 — 2회차부터는 이전 회차의 중지된 정책까지 — 에 남은 미할당(reserved) 예약을 보고 `preorder_allocations_pending`으로
 * 거절한다. 예약 조건 목록(`admin_list_goods_preorders`)은 상품의 모든 정책을 정책별 미할당 수량과 함께 주므로, 화면도 이 합계로
 * 전환 버튼을 막는다.
 */
export function pendingPreorderReservationsByVariant(policies: readonly Pick<AdminGoodsPreorder, 'variantId' | 'reservedQty'>[]): Map<string, number> {
  const pending = new Map<string, number>();
  for (const policy of policies) {
    if (policy.reservedQty > 0) pending.set(policy.variantId, (pending.get(policy.variantId) ?? 0) + policy.reservedQty);
  }
  return pending;
}

/**
 * 랜덤 판매 상품의 일괄 예약 저장(`admin_save_random_goods_preorders`). 모든 판매 중 옵션이 같은 접수 기간·발송 예정일을 쓰고
 * 승인 예약 물량만 옵션별이다. 중지·일반 재고 전환도 모든 옵션을 한 트랜잭션으로 바꾼다(옵션 하나만 바꾸면 커밋에서 거절된다).
 */
export type RandomPreorderBulkState = 'draft' | 'active' | 'stopped' | 'stock';
export interface RandomPreorderOptionInput {
  variantId: string;
  /** 이어 쓸 초안(초안·활성화) 또는 지금 선택된 정책(중지·일반 재고 전환). 새로 만들면 null. */
  policyId: string | null;
  expectedRevision: number | null;
  /** 초안·활성화만. 활성화는 모든 옵션에 필요하다. */
  capacityQty?: number | null;
}
export interface RandomPreorderRequest {
  state: RandomPreorderBulkState;
  values: Pick<GoodsPreorderInput, 'startsAt' | 'endsAt' | 'expectedShipDate' | 'approvalReference'> | null;
  options: RandomPreorderOptionInput[];
}
function capacityValue(value: unknown): number | null | false {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'string' ? !/^[1-9]\d*$/.test(value) : typeof value !== 'number') return false;
  const number = Number(value);
  return integer(number, 1) ? number : false;
}
export function parseRandomPreorderRequest(stateValue: unknown, valuesValue: unknown, optionsValue: unknown): RandomPreorderRequest | null {
  if (!['draft', 'active', 'stopped', 'stock'].includes(String(stateValue)) || !Array.isArray(optionsValue)
    || !optionsValue.length || optionsValue.length > 100) return null;
  const state = stateValue as RandomPreorderBulkState;
  const schedule = state === 'draft' || state === 'active';
  let values: RandomPreorderRequest['values'] = null;
  if (schedule) {
    if (!object(valuesValue)) return null;
    /* 활성화는 옵션별 물량을 따로 검사하므로 공통 값 검사에는 자리 값 1을 넣는다. */
    const parsed = parseGoodsPreorderInput({ state, capacityQty: state === 'active' ? 1 : null, startsAt: valuesValue.startsAt,
      endsAt: valuesValue.endsAt, expectedShipDate: valuesValue.expectedShipDate, approvalReference: valuesValue.approvalReference });
    if (!parsed) return null;
    values = { startsAt: parsed.startsAt, endsAt: parsed.endsAt, expectedShipDate: parsed.expectedShipDate, approvalReference: parsed.approvalReference };
  } else if (valuesValue != null) return null;
  const options: RandomPreorderOptionInput[] = [];
  for (const row of optionsValue) {
    if (!object(row) || !isUuid(row.variantId) || options.some((option) => option.variantId === row.variantId)
      || (row.policyId !== null && !isUuid(row.policyId)) || (row.expectedRevision !== null && !integer(row.expectedRevision, 1))
      || (row.policyId === null) !== (row.expectedRevision === null)
      || Object.keys(row).some((key) => !['variantId', 'policyId', 'expectedRevision', ...(schedule ? ['capacityQty'] : [])].includes(key))) return null;
    const base = { variantId: row.variantId, policyId: row.policyId as string | null, expectedRevision: row.expectedRevision as number | null };
    if (!schedule) {
      if (base.policyId === null) return null;
      options.push(base);
      continue;
    }
    const capacityQty = capacityValue(row.capacityQty);
    if (capacityQty === false || (state === 'active' && capacityQty === null)) return null;
    options.push({ ...base, capacityQty });
  }
  return { state, values, options };
}

export function preorderMutationError(message: string): string {
  /* D5② 랜덤 판매 상품은 모든 옵션이 같은 일정으로 예약해야 한다 — 커밋 시점 지연 제약이 random_option_*로 거절한다. */
  if (RANDOM_OPTION_PROBLEMS.some((code) => message.includes(code))) return goodsOptionSaleModeErrorMessage(message);
  const errors: Record<string, string> = {
    preorder_admin_required: '예약판매 적용과 일반 재고 판매 전환은 계정 주매니저·통합 매니저만 할 수 있습니다. 예약 조건은 임시저장으로 저장해주세요.',
    preorder_policy_changed: '예약 조건이 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해주세요.',
    preorder_policy_not_configured: '승인 물량·접수 기간(종료는 지금 이후)·발송 예정일(접수 종료일 이후)·승인 근거를 모두 입력해야 판매에 적용할 수 있습니다.',
    preorder_policy_already_active: '이 옵션에 이미 적용 중인 예약이 있습니다. 기존 예약 접수를 먼저 중지해주세요.',
    preorder_policy_immutable: '판매에 적용한 예약 조건은 변경할 수 없습니다. 접수를 중지하고 새 승인 건을 등록해주세요.',
    preorder_runtime_not_ready: '예약판매 기능을 준비 중입니다. 아직 판매에 적용할 수 없습니다.',
    preorder_allocations_pending: '아직 실물 재고를 할당하지 않은 예약 주문이 있습니다. 해당 주문을 먼저 처리해주세요.',
    stop_preorder_before_stock_supply: '예약 접수를 먼저 중지한 뒤 일반 재고 판매로 전환해주세요.',
    preorder_physical_stock_changed: '실물 재고가 변경되었습니다. 예약 주문 목록을 새로고침하고 다시 확인해주세요.',
    preorder_physical_stock_shortfall: '선택한 예약 주문을 할당할 실제 옵션 재고가 부족합니다.',
    preorder_payment_required: '입금·결제가 확인된 예약 주문에만 실물 재고를 할당할 수 있습니다.',
    preorder_reservation_released: '취소된 예약 품목은 재고 할당 대상에서 제외해주세요.',
    random_preorder_options_mismatch: '판매 중인 옵션이나 예약 상태가 바뀌었습니다. 예약 조건을 새로고침한 뒤 모든 옵션을 다시 확인해주세요.',
    random_option_required: '랜덤 판매 상품에서만 모든 옵션을 한 번에 예약할 수 있습니다. 판매 방식을 확인해주세요.',
    invalid_random_preorder: '승인 물량·접수 기간·발송 예정일·승인 근거를 확인해주세요.',
    'order cancellation in progress': '취소·클레임이 진행 중인 주문은 해당 처리를 먼저 확인해주세요.',
    'order fulfillment hold': '출고 보류 중인 주문(테스트 결제 또는 결제사 취소)이 선택에 있습니다. "출고 보류" 표시가 붙은 주문을 빼고 다시 할당해주세요.',
  };
  return errors[message] ?? '예약판매 처리를 완료하지 못했습니다. 입력과 현재 상품 상태를 확인해주세요.';
}
