import { normalizeCheckoutAddress, type CheckoutAddress } from '@/lib/checkout';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
import { CHANGED_BY_OTHER, SAVE_MISMATCH_MESSAGE, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { ADMIN_SALES_ACCESS_DENIED } from '@/lib/admin/vocabulary';

export interface OrderAddressContext {
  orderNumber?: string;
  isGift?: boolean;
  /**
   * 우편번호·기본 주소를 바꿀 수 없는 주문인가. 배송비 기준 기록이 없는 주문(퀵·방문수령 배송 건이 있거나 옛 주문)은 수령인·연락처·상세 주소·
   * 배송 메모만 바꿀 수 있다 — DB(admin_change_order_address)가 그 두 칸의 변경을 거절한다. 화면이 두 칸을 미리 잠근다.
   * 값이 없으면 알 수 없는 것이고 잠그지 않는다(판정은 DB가 한다).
   */
  destinationLocked?: boolean;
  orderId: string; address: CheckoutAddress; revision: number; allowed: boolean; blocker: string | null; shipmentCount: number;
  history: { id: string; changedAt: string; actorName: string; before: CheckoutAddress; after: CheckoutAddress; reason: string }[];
}
export interface OrderAddressRequest { id: string; orderId: string; revision: number; address: CheckoutAddress; reason: string; agreed: boolean }
export interface OrderAddressReceipt { id: string; orderId: string; changedAt: string; address: CheckoutAddress; reason: string; currentMatches: boolean }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const control = /[\u0000-\u001f\u007f]/;
const emptyAddress = (): CheckoutAddress => ({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' });
function oldAddress(value: unknown): CheckoutAddress | null {
  if (!record(value)) return null;
  const result = emptyAddress();
  for (const key of Object.keys(result) as (keyof CheckoutAddress)[]) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return null;
    result[key] = typeof value[key] === 'string' ? value[key] as string : '';
  }
  return result;
}
export function parseOrderAddressContext(value: unknown): OrderAddressContext | null {
  if (!record(value) || !isUuid(value.orderId) || !integer(value.revision) || typeof value.allowed !== 'boolean'
    || (value.orderNumber !== undefined && !isCommerceNumber(value.orderNumber, 'order'))
    || (value.blocker !== null && typeof value.blocker !== 'string') || !integer(value.shipmentCount)
    || !Array.isArray(value.history) || value.history.length > 20) return null;
  const address = oldAddress(value.address); if (!address) return null;
  const history: OrderAddressContext['history'] = [];
  for (const entry of value.history) {
    if (!record(entry) || !isUuid(entry.id) || !date(entry.changedAt) || typeof entry.actorName !== 'string' || typeof entry.reason !== 'string') return null;
    const before = oldAddress(entry.before); const after = oldAddress(entry.after); if (!before || !after) return null;
    history.push({ id: entry.id, changedAt: entry.changedAt, actorName: entry.actorName, reason: entry.reason, before, after });
  }
  return { orderId: value.orderId, ...(value.orderNumber ? { orderNumber: value.orderNumber as string } : {}), ...(value.isGift === undefined ? {} : { isGift: value.isGift === true }), address, revision: value.revision, allowed: value.allowed, blocker: value.blocker as string | null, shipmentCount: value.shipmentCount, history };
}
export function parseOrderAddressReceipt(value: unknown): OrderAddressReceipt | null {
  if (!record(value) || !isUuid(value.id) || !isUuid(value.orderId) || !date(value.changedAt) || typeof value.reason !== 'string' || typeof value.currentMatches !== 'boolean') return null;
  const address = normalizeCheckoutAddress(value.address); if (!address) return null;
  return { id: value.id, orderId: value.orderId, changedAt: value.changedAt, address, reason: value.reason, currentMatches: value.currentMatches };
}
export function orderAddressReceiptMatches(receipt: OrderAddressReceipt, request: OrderAddressRequest): boolean {
  return receipt.id === request.id && receipt.orderId === request.orderId && receipt.reason === request.reason
    && (Object.keys(emptyAddress()) as (keyof CheckoutAddress)[]).every(key => (receipt.address[key] ?? '') === (request.address[key] ?? ''));
}
/** 화면 칸 이름(수령인·연락처·우편번호·기본 주소)과 같은 말로, 어느 칸이 어떻게 틀렸는지까지 알려 준다. */
const ORDER_ADDRESS_INVALID_MESSAGE = '수령인·연락처·우편번호·기본 주소 중 비었거나 형식이 맞지 않는 칸이 있습니다. 우편번호는 숫자 5자리, 연락처는 숫자 8~15자리로 적어 주세요.';
const ORDER_ADDRESS_REASON_MESSAGE = '변경 사유를 1~500자로 적어 주세요.';

/** 다른 사람이 먼저 바꿨을 때 누르는 버튼. 적은 내용은 그대로 두고 지금 배송지만 다시 읽는다. */
export const ORDER_ADDRESS_RELOAD_LABEL = '최신 배송지 불러오기';
/** 저장됐는지 확인했는데 저장된 것이 없을 때 누른다. 같은 내용을 같은 번호로 다시 보내므로 두 번 저장되지 않는다. */
export const ORDER_ADDRESS_RESEND_LABEL = '같은 내용으로 다시 저장';
/** 주문 처리 쪽 화면(order-actions)과 같은 말이다. 권한 이름은 설정 화면의 낱말(판매 관리)이다. */
export const ORDER_ADDRESS_PERMISSION_MESSAGE = ADMIN_SALES_ACCESS_DENIED;

export function normalizeOrderAddressRequest(value: unknown): { request: OrderAddressRequest } | { error: string } {
  if (!record(value) || !isUuid(value.id) || !isUuid(value.orderId) || !integer(value.revision)) return { error: '주문 정보를 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 눌러 주세요.' };
  const address = normalizeCheckoutAddress(value.address);
  if (!address || Object.values(address).some(text => control.test(text))) return { error: ORDER_ADDRESS_INVALID_MESSAGE };
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 500 || control.test(value.reason)) return { error: ORDER_ADDRESS_REASON_MESSAGE };
  /* 화면은 늘 true를 보낸다(확인 체크는 없앴다). DB가 이 값을 요구해 인자는 남아 있다. */
  if (value.agreed !== true) return { error: '배송지 변경 요청을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 눌러 주세요.' };
  return { request: { id: value.id.toLowerCase(), orderId: value.orderId.toLowerCase(), revision: value.revision,
    address: { ...address, address2: address.address2 ?? '', deliveryNote: address.deliveryNote ?? '' }, reason: value.reason.trim(), agreed: true } };
}
/** DB가 돌려주는 '지금 바꿀 수 없는 이유'(`blocker`)이자 저장할 때 받는 거절 값이다. 운영자가 쓰는 낱말(신규주문·발주확인·출고지시)로 쓴다. */
const ORDER_ADDRESS_BLOCKERS: Record<string, string> = {
  order_not_ready: '신규주문이나 발주확인 상태의 주문만 배송지를 바꿀 수 있습니다.',
  order_dispatched: '출고지시를 이미 보냈거나 발송한 기록이 있어 배송지를 바꿀 수 없습니다.',
  shipments_missing: '연결된 배송 건이 없어 배송지를 바꿀 수 없습니다.',
  order_claim_open: '진행 중인 취소·반품·교환 요청이 있어 배송지를 바꿀 수 없습니다. 요청을 먼저 처리해 주세요.',
};
/** 배송지를 바꿀 수 없는 이유. 모르는 값은 일반 문구로 접는다(영문 값을 그대로 보이지 않는다). */
export function orderAddressBlockerMessage(blocker: string | null | undefined): string {
  return (blocker ? ORDER_ADDRESS_BLOCKERS[blocker] : undefined) ?? '지금은 배송지를 바꿀 수 없습니다.';
}

/** 우편번호·기본 주소를 바꿀 수 없는 주문의 안내. 저장 때 DB가 거절하는 문구이자, 두 칸을 미리 잠근 이유다. */
export const ORDER_ADDRESS_DESTINATION_LOCKED_MESSAGE = '배송비 기준을 확인할 수 없는 주문(퀵·방문수령이거나 옛 주문)이라 우편번호·기본 주소는 바꿀 수 없습니다. 수령인·연락처·상세 주소·배송 메모는 바꿀 수 있습니다.';
/** 배송비를 다시 따져야 바꿀 수 있는 칸(받는 곳). */
export const ORDER_ADDRESS_DESTINATION_FIELDS: readonly (keyof CheckoutAddress)[] = ['postalCode', 'address1'];

const SHIPPING_FEE_SNAPSHOT_KEYS = ['policySubtotal', 'baseFee', 'freeThreshold', 'policyFee', 'individualFee', 'totalFee'] as const;

/**
 * 우편번호·기본 주소를 바꿀 수 없는 주문인가 — DB(admin_change_order_address)가 `order_address_quote_unavailable`로 거절하는 조건과 같다.
 * 계산 방식 2 주문은 새 주소로 배송비를 다시 계산해 보므로 해당하지 않는다. 그 밖의 주문은 배송 건마다 택배이고 주문 때의 배송비 기준
 * (출고지·기준 금액 여섯 값·합계)이 배송 건의 배송비와 맞게 남아 있어야 한다.
 */
export function orderAddressDestinationLocked(calculationVersion: unknown, shipments: readonly { origin_id?: unknown; delivery_method?: unknown; shipping_fee?: unknown; shipping_fee_snapshot?: unknown }[]): boolean {
  if (calculationVersion === 2) return false;
  return shipments.some((shipment) => {
    const snapshot = shipment.shipping_fee_snapshot;
    if (shipment.delivery_method !== 'parcel' || !record(snapshot)) return true;
    return snapshot.originId !== shipment.origin_id || SHIPPING_FEE_SNAPSHOT_KEYS.some(key => !(key in snapshot))
      || typeof snapshot.totalFee !== 'number' || snapshot.totalFee !== Number(shipment.shipping_fee);
  });
}

export function orderAddressError(code: string | undefined, message: string | undefined): string {
  if (code === '42501') return ORDER_ADDRESS_PERMISSION_MESSAGE;
  if (code === 'PT409') return `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다. [${ORDER_ADDRESS_RELOAD_LABEL}]를 누르면 지금 배송지를 다시 불러옵니다.`;
  if (code === '23505') return SAVE_MISMATCH_MESSAGE;
  const messages: Record<string, string> = {
    ...ORDER_ADDRESS_BLOCKERS,
    order_address_quote_unavailable: ORDER_ADDRESS_DESTINATION_LOCKED_MESSAGE,
    order_address_region_unavailable: '바꾸려는 지역으로 배송할 수 있는지 확인되지 않았습니다. 배송 설정과 지역별 추가배송비를 확인해 주세요.',
    order_address_shipping_fee_changed: '바꾸려는 지역은 배송비가 달라져서 바꿀 수 없습니다. 결제한 배송비 그대로 보낼 수 있는 지역으로만 바꿀 수 있습니다.',
    order_address_unchanged: '바뀐 내용이 없습니다. 고칠 칸을 고친 뒤 저장해 주세요.',
    invalid_order_address: ORDER_ADDRESS_INVALID_MESSAGE,
    invalid_order_address_change: ORDER_ADDRESS_REASON_MESSAGE,
    order_not_found: '주문을 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 열어 주세요.',
  };
  return messages[message ?? ''] ?? SAVE_UNKNOWN_MESSAGE;
}

/**
 * 저장 전 확인창에 보이는, 바뀌는 칸만의 '이전 → 새 값' 줄. 값이 같은 칸은 줄이 없고, 줄이 하나도 없으면 바뀐 것이 없다.
 * 비교는 DB가 바뀐 칸을 가리는 기준(저장된 값과 정리한 새 값을 글자 그대로 비교)과 같다.
 */
export function orderAddressChangeLines(before: CheckoutAddress, after: CheckoutAddress): string[] {
  const same = (key: keyof CheckoutAddress) => (before[key] ?? '') === (after[key] ?? '');
  const shown = (value: string | undefined) => value?.trim() ? value : '없음';
  const place = (address: CheckoutAddress) => `${address.postalCode ? `(${address.postalCode}) ` : ''}${address.address1}${address.address2 ? ` ${address.address2}` : ''}`;
  const lines: string[] = [];
  if (!same('recipientName')) lines.push(`수령인: ${shown(before.recipientName)} → ${shown(after.recipientName)}`);
  if (!same('phone')) lines.push(`연락처: ${shown(before.phone)} → ${shown(after.phone)}`);
  if (!same('postalCode') || !same('address1') || !same('address2')) lines.push(`주소: ${place(before)} → ${place(after)}`);
  if (!same('deliveryNote')) lines.push(`배송 메모: ${shown(before.deliveryNote)} → ${shown(after.deliveryNote)}`);
  return lines;
}

/**
 * 저장 전 확인창 본문: 어느 주문의 배송지를 무엇에서 무엇으로 바꾸는지와, 눈에 안 보이는 결과(모든 배송 건에 적용·돈은 그대로·누가 요청한 변경으로 남는지).
 * 화면의 확인 체크("고객이 동의했음을 확인했습니다")가 말하던 사실은 마지막 줄로 옮겼다 — DB는 선물 주문이면 받는 분, 아니면 구매자의 요청으로 적는다.
 */
export function orderAddressConfirmMessage(context: Pick<OrderAddressContext, 'orderNumber' | 'isGift' | 'shipmentCount'>, before: CheckoutAddress, after: CheckoutAddress): string {
  const target = context.orderNumber ? `주문 ${context.orderNumber}` : '이 주문';
  const scope = context.shipmentCount > 1 ? ` 배송 건 ${context.shipmentCount}개 모두에 적용됩니다.` : '';
  const requester = context.isGift ? '선물 받는 분이' : '구매자가';
  return [
    `${target}의 배송지를 바꿉니다.${scope}`,
    '',
    ...orderAddressChangeLines(before, after),
    '',
    `${requester} 요청한 변경으로 기록됩니다. 결제금액과 배송비는 그대로입니다.`,
  ].join('\n');
}
