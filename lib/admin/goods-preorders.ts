import { isUuid } from '@/lib/uuid';
import { isGoodsShipDate } from '@/lib/goods-preorders';
import { RANDOM_OPTION_PROBLEMS, goodsOptionSaleModeErrorMessage } from '@/lib/goods-option-sale-mode';

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
    preorder_admin_required: '예약 활성화와 일반 재고 판매 전환은 관리자 계정에서 할 수 있습니다.',
    preorder_policy_changed: '예약 조건이 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해주세요.',
    preorder_policy_not_configured: '승인 물량·접수 기간·발송 예정일·승인 근거를 모두 입력해주세요.',
    preorder_policy_already_active: '이 옵션의 기존 예약 접수를 먼저 중지해주세요.',
    preorder_policy_immutable: '활성화한 예약 조건은 변경할 수 없습니다. 접수를 중지하고 새 승인 건을 등록해주세요.',
    preorder_runtime_not_ready: '예약판매 기능을 준비 중입니다. 아직 활성화할 수 없습니다.',
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
  };
  return errors[message] ?? '예약판매 처리를 완료하지 못했습니다. 입력과 현재 상품 상태를 확인해주세요.';
}
