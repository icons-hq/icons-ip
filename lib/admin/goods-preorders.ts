import { isGoodsShipDate } from '@/lib/goods-preorders';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647;
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
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
    if (!object(row) || !uuid(row.id) || !uuid(row.variantId) || typeof row.goodId !== 'string' || !row.goodId
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
    if (!object(row) || !uuid(row.orderItemId) || !uuid(row.orderId) || !uuid(row.policyId) || !uuid(row.variantId)
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
  if (!Array.isArray(idsValue) || !idsValue.length || idsValue.length > 100 || !idsValue.every(uuid)
    || new Set(idsValue).size !== idsValue.length) return null;
  const expectedStock: Record<string, number> = {};
  for (const id of idsValue) {
    const row = rows.find((item) => item.orderItemId === id);
    if (!row || !uuid(row.variantId) || !integer(row.physicalStockQty)
      || (Object.hasOwn(expectedStock, row.variantId) && expectedStock[row.variantId] !== row.physicalStockQty)) return null;
    expectedStock[row.variantId] = row.physicalStockQty;
  }
  return { orderItemIds: idsValue, expectedStock };
}

export function preorderMutationError(message: string): string {
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
    'order cancellation in progress': '취소·클레임이 진행 중인 주문은 해당 처리를 먼저 확인해주세요.',
  };
  return errors[message] ?? '예약판매 처리를 완료하지 못했습니다. 입력과 현재 상품 상태를 확인해주세요.';
}
