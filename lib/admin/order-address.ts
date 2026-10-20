import { normalizeCheckoutAddress, type CheckoutAddress } from '@/lib/checkout';
import { isUuid } from '@/lib/uuid';

export interface OrderAddressContext {
  isGift?: boolean;
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
    || (value.blocker !== null && typeof value.blocker !== 'string') || !integer(value.shipmentCount)
    || !Array.isArray(value.history) || value.history.length > 20) return null;
  const address = oldAddress(value.address); if (!address) return null;
  const history: OrderAddressContext['history'] = [];
  for (const entry of value.history) {
    if (!record(entry) || !isUuid(entry.id) || !date(entry.changedAt) || typeof entry.actorName !== 'string' || typeof entry.reason !== 'string') return null;
    const before = oldAddress(entry.before); const after = oldAddress(entry.after); if (!before || !after) return null;
    history.push({ id: entry.id, changedAt: entry.changedAt, actorName: entry.actorName, reason: entry.reason, before, after });
  }
  return { orderId: value.orderId, ...(value.isGift === undefined ? {} : { isGift: value.isGift === true }), address, revision: value.revision, allowed: value.allowed, blocker: value.blocker as string | null, shipmentCount: value.shipmentCount, history };
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
export function normalizeOrderAddressRequest(value: unknown): { request: OrderAddressRequest } | { error: string } {
  if (!record(value) || !isUuid(value.id) || !isUuid(value.orderId) || !integer(value.revision)) return { error: '주문과 변경 요청을 확인해주세요.' };
  const address = normalizeCheckoutAddress(value.address);
  if (!address || Object.values(address).some(text => control.test(text))) return { error: '수령자·연락처·우편번호·주소를 확인해주세요.' };
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 500 || control.test(value.reason)) return { error: '고객 요청의 확인 근거를 500자 이내로 입력해주세요.' };
  if (value.agreed !== true) return { error: '고객이 동의한 주문 전체 배송지인지 확인해주세요.' };
  return { request: { id: value.id.toLowerCase(), orderId: value.orderId.toLowerCase(), revision: value.revision,
    address: { ...address, address2: address.address2 ?? '', deliveryNote: address.deliveryNote ?? '' }, reason: value.reason.trim(), agreed: true } };
}
export function orderAddressError(code: string | undefined, message: string | undefined): string {
  if (code === '42501') return '현재 매니저 권한을 확인해주세요.';
  if (code === 'PT409') return '다른 담당자가 배송지를 변경했습니다. 입력을 보존한 채 최신 배송지를 다시 확인해주세요.';
  if (code === '23505') return '이 요청번호에 다른 변경 내용이 저장되어 있습니다. 저장 결과를 확인해주세요.';
  const messages: Record<string, string> = {
    order_not_ready: '결제완료 또는 발주확인 단계의 주문만 수정할 수 있습니다.',
    order_dispatched: '출고지시가 전달됐거나 발송 이력이 있어 수정할 수 없습니다.',
    shipments_missing: '연결된 배송건이 없어 수정할 수 없습니다.',
    order_claim_open: '진행 중인 취소·반품·교환 요청을 먼저 확인해주세요.',
    order_address_quote_unavailable: '배송비 근거가 부족하거나 퀵·방문수령 주문이어서 배송 지역을 변경할 수 없습니다. 연락처·상세주소·메모는 수정할 수 있습니다.',
    order_address_region_unavailable: '변경한 지역의 배송 가능 여부를 확인할 수 없습니다. 배송정보와 지역 정책을 확인해주세요.',
    order_address_shipping_fee_changed: '변경한 지역은 배송비가 달라집니다. 기존 결제금액을 유지한 배송지 수정은 할 수 없습니다.',
    order_address_unchanged: '변경된 배송 정보가 없습니다.',
    invalid_order_address: '수령자·연락처·우편번호·주소를 확인해주세요.',
    invalid_order_address_change: '고객 동의와 변경 근거를 확인해주세요.',
    order_not_found: '주문을 찾을 수 없습니다.',
  };
  return messages[message ?? ''] ?? '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.';
}
