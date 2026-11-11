import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { ORDER_CLAIM_BUYER_REASON_TYPES, isOrderClaimStage, isOrderClaimType, normalizeRefundAccount, type OrderClaimStage, type OrderClaimType, type RefundAccountInput } from '@/lib/orders/claims';
import { isShippingCarrierCodeFormat, isTrackingNumber, normalizeTrackingNumber, type ShippingCarrierRegistry } from '@/lib/orders/shipment';

export const SELLER_CLAIM_PATH = '/admin/sales/orders';
export const SELLER_CLAIM_SOURCES = [
  { value: 'inquiry', label: '연결된 고객문의' },
  { value: 'phone', label: '전화 상담' },
  { value: 'email', label: '이메일' },
  { value: 'other', label: '기타 고객지원' },
] as const;
export const SELLER_CLAIM_COLLECTION_METHODS = [
  { value: 'not_requested', label: '접수 후 수거 협의' },
  { value: 'seller_arranged', label: '판매자 별도 수거 예정' },
  { value: 'customer_sent', label: '구매자가 이미 발송' },
] as const;
export type SellerClaimSource = typeof SELLER_CLAIM_SOURCES[number]['value'];
export type SellerClaimCollectionMethod = typeof SELLER_CLAIM_COLLECTION_METHODS[number]['value'];
export interface SellerClaimAddress { recipientName: string; phone: string; postalCode: string; address1: string; address2: string }
export interface SellerClaimCollectionInput {
  shipmentId: string; method: SellerClaimCollectionMethod; carrier: string | null; trackingNumber: string | null; note: string;
}
export interface SellerClaimCollectionTarget {
  shipmentId: string; originId: string; originName: string; returnAddress: string; status: string;
  items: { id: string; name: string; qty: number }[];
}
export interface SellerClaimContext {
  orderNumber?: string;
  orderId: string; orderStatus: string; orderTotal: number; buyerName: string | null;
  createdAt: string; deliveredAt: string | null; observedAt: string; address: SellerClaimAddress;
  blockedReasons: Record<OrderWithdrawalReasonType, string | null>;
  cancelBlockedReason: string | null;
  digitalExchangeBlocked: boolean;
  activeClaim: { id: string; claimType: OrderClaimType; stage: OrderClaimStage } | null;
  collections: SellerClaimCollectionTarget[];
  carriers: ShippingCarrierRegistry;
  inquiries: { id: string; reference: number; title: string; createdAt: string }[];
}
export interface SellerClaimReceipt {
  requestId: string; claimId: string; reference: number; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage;
  requestedAt: string; actorId: string; actorName: string | null; source: SellerClaimSource; inquiryId: string | null;
  customerRequestedAt: string; agreementEvidence: string; collectionAddress: SellerClaimAddress | null;
  collections: (SellerClaimCollectionInput & Pick<SellerClaimCollectionTarget, 'originId' | 'originName' | 'items'>)[];
}
export interface SellerClaimInput {
  requestId: string; orderId: string; claimType: OrderClaimType; reasonType: OrderWithdrawalReasonType; reason: string;
  source: SellerClaimSource; inquiryId: string | null; customerRequestedAt: string; agreementEvidence: string; agreementConfirmed: boolean;
  collectionAddress: SellerClaimAddress | null; collections: SellerClaimCollectionInput[]; refundAccount: RefundAccountInput | null;
}
export type SellerClaimPayload = Omit<SellerClaimInput, 'requestId' | 'refundAccount'>;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const known = <T extends readonly { value: string }[]>(options: T, value: unknown): value is T[number]['value'] => options.some(option => option.value === value);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

export function sellerClaimKstInput(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
}
function parseKstInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return sellerClaimKstInput(iso) === value && !iso.startsWith('-') ? iso : null;
}
function readAddress(value: unknown): SellerClaimAddress {
  const data = record(value) ? value : {};
  return { recipientName: string(data.recipientName), phone: string(data.phone), postalCode: string(data.postalCode), address1: string(data.address1), address2: string(data.address2) };
}

export function parseSellerClaimInput(input: unknown): { ok: true; requestId: string; payload: SellerClaimPayload; refundAccount: RefundAccountInput | null } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false, error } as const);
  if (!record(input) || !exactKeys(input, ['requestId','orderId','claimType','reasonType','reason','source','inquiryId','customerRequestedAt','agreementEvidence','agreementConfirmed','collectionAddress','collections','refundAccount'])
    || !isUuid(input.requestId) || !isUuid(input.orderId) || !isOrderClaimType(input.claimType)
    || typeof input.reasonType !== 'string' || !isOrderWithdrawalReasonType(input.reasonType) || !known(SELLER_CLAIM_SOURCES, input.source)) return fail('주문과 접수 유형을 다시 확인해주세요.');
  /* R7: 취소(발주확인 전)는 단순 변심만 받는다. DB(private.validate_seller_claim_intake)도 같은 규칙으로 거절한다. */
  if (!(ORDER_CLAIM_BUYER_REASON_TYPES[input.claimType] as readonly string[]).includes(input.reasonType)) {
    return fail('취소 접수 사유는 단순 변심만 선택할 수 있습니다. 상품 하자·오배송은 반품·교환으로 접수해주세요.');
  }
  const reason = string(input.reason); const agreementEvidence = string(input.agreementEvidence);
  if (!reason || reason.length > 200 || controls.test(reason)) return fail('접수 사유를 1~200자로 입력해주세요.');
  if (!agreementEvidence || agreementEvidence.length > 1000 || controls.test(agreementEvidence)) return fail('고객 합의 근거를 1~1,000자로 입력해주세요.');
  if (input.agreementConfirmed !== true) return fail('고객의 주문 전체 접수 동의를 확인해주세요.');
  const customerRequestedAt = parseKstInput(string(input.customerRequestedAt));
  if (!customerRequestedAt) return fail('고객 요청 시각을 한국 시간으로 입력해주세요.');
  if (input.source === 'inquiry' ? !isUuid(input.inquiryId) : input.inquiryId !== null) return fail('이 주문에 연결된 고객문의를 선택해주세요.');

  let address: SellerClaimAddress | null = null;
  if (input.claimType === 'cancel') {
    if (input.collectionAddress !== null || !Array.isArray(input.collections) || input.collections.length) return fail('취소 접수에는 수거 주소나 수거 계획을 입력하지 않습니다.');
  } else {
  if (!record(input.collectionAddress) || !exactKeys(input.collectionAddress, ['recipientName','phone','postalCode','address1','address2'])
    || Object.values(input.collectionAddress).some(value => typeof value !== 'string')) return fail('수거 주소를 확인해주세요.');
  address = readAddress(input.collectionAddress);
  address.phone = address.phone.replace(/[\s-]/g, '');
  if (!address.recipientName || address.recipientName.length > 50 || !/^[0-9]{8,15}$/.test(address.phone)
    || !/^[0-9]{5}$/.test(address.postalCode) || !address.address1 || address.address1.length > 200 || address.address2.length > 200
    || Object.values(address).some(value => /[\u0000-\u001f\u007f]/.test(value))) return fail('수거지 이름·연락처·우편번호·주소를 확인해주세요.');
  if (!Array.isArray(input.collections) || input.collections.length < 1 || input.collections.length > 1000) return fail('전체 출고지의 수거 계획을 확인해주세요.');
  }
  const collections: SellerClaimCollectionInput[] = [];
  for (const row of input.collections as unknown[]) {
    if (!record(row) || !exactKeys(row, ['shipmentId','method','carrier','trackingNumber','note']) || !isUuid(row.shipmentId)
      || !known(SELLER_CLAIM_COLLECTION_METHODS, row.method) || !nullableText(row.carrier) || !nullableText(row.trackingNumber)) return fail('출고지별 수거 방법을 확인해주세요.');
    const carrier = string(row.carrier) || null; const trackingNumber = normalizeTrackingNumber(string(row.trackingNumber)) || null; const note = string(row.note);
    if (note.length > 500 || controls.test(note) || (Boolean(carrier) !== Boolean(trackingNumber))
      || (row.method === 'customer_sent' && !carrier) || (row.method === 'not_requested' && carrier)
      || (row.method === 'seller_arranged' && !note) || (carrier && (!isShippingCarrierCodeFormat(carrier) || !isTrackingNumber(trackingNumber!)))) return fail('수거 메모와 택배사·송장번호를 확인해주세요. 구매자가 발송한 경우 운송장 정보가 필요합니다.');
    collections.push({ shipmentId: row.shipmentId.toLowerCase(), method: row.method, carrier, trackingNumber, note });
  }
  if (new Set(collections.map(row => row.shipmentId)).size !== collections.length) return fail('중복된 출고지 수거 계획이 있습니다. 주문을 다시 열어주세요.');
  if (input.refundAccount !== null && (!record(input.refundAccount) || !exactKeys(input.refundAccount, ['bankName','accountNumber','accountHolder'])
    || Object.values(input.refundAccount).some(value => typeof value !== 'string'))) return fail('환불계좌 입력을 확인해주세요.');
  const account = normalizeRefundAccount(input.refundAccount ?? {});
  if (!account.ok) return fail(account.error);
  if (input.claimType === 'exchange' && account.value) return fail('교환 접수에는 환불계좌를 저장하지 않습니다.');
  if (account.value && (controls.test(account.value.bankName) || controls.test(account.value.accountHolder))) return fail('환불계좌 입력을 확인해주세요.');
  return { ok: true, requestId: input.requestId.toLowerCase(), refundAccount: account.value, payload: {
    orderId: input.orderId.toLowerCase(), claimType: input.claimType, reasonType: input.reasonType, reason,
    source: input.source, inquiryId: typeof input.inquiryId === 'string' ? input.inquiryId.toLowerCase() : null,
    customerRequestedAt, agreementEvidence, agreementConfirmed: true, collectionAddress: address, collections,
  } };
}

function parseItems(value: unknown): SellerClaimCollectionTarget['items'] | null {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => !record(item) || !isUuid(item.id) || typeof item.name !== 'string' || !Number.isSafeInteger(item.qty) || Number(item.qty) < 1)) return null;
  return value as SellerClaimCollectionTarget['items'];
}
export function parseSellerClaimContext(value: unknown): SellerClaimContext | null {
  if (!record(value) || !isUuid(value.orderId) || typeof value.orderStatus !== 'string' || !Number.isSafeInteger(value.orderTotal) || Number(value.orderTotal) < 0
    || (value.orderNumber !== undefined && !isCommerceNumber(value.orderNumber, 'order'))
    || !nullableText(value.buyerName) || !date(value.createdAt) || !(value.deliveredAt === null || date(value.deliveredAt)) || !date(value.observedAt)
    || !record(value.blockedReasons) || !nullableText(value.blockedReasons.change_of_mind) || !nullableText(value.blockedReasons.defect) || !nullableText(value.cancelBlockedReason) || typeof value.digitalExchangeBlocked !== 'boolean'
    || !Array.isArray(value.collections) || !Array.isArray(value.inquiries) || !Array.isArray(value.carriers)
    || value.carriers.some(carrier => !record(carrier) || typeof carrier.code !== 'string' || !isShippingCarrierCodeFormat(carrier.code)
      || typeof carrier.label !== 'string' || typeof carrier.active !== 'boolean' || typeof carrier.trackingUrlTemplate !== 'string')) return null;
  if (value.activeClaim !== null && (!record(value.activeClaim) || !isUuid(value.activeClaim.id) || !isOrderClaimType(value.activeClaim.claimType) || !isOrderClaimStage(value.activeClaim.stage))) return null;
  const collections: SellerClaimCollectionTarget[] = [];
  for (const row of value.collections) {
    if (!record(row) || !isUuid(row.shipmentId) || !isUuid(row.originId) || typeof row.originName !== 'string' || typeof row.returnAddress !== 'string' || typeof row.status !== 'string') return null;
    const items = parseItems(row.items); if (!items) return null;
    collections.push({ shipmentId: row.shipmentId, originId: row.originId, originName: row.originName, returnAddress: row.returnAddress, status: row.status, items });
  }
  if (new Set(collections.map(row => row.shipmentId)).size !== collections.length || value.inquiries.some(row => !record(row) || !isUuid(row.id) || !Number.isSafeInteger(row.reference) || Number(row.reference) < 1 || typeof row.title !== 'string' || !date(row.createdAt))) return null;
  return { ...value, address: readAddress(value.address), collections } as unknown as SellerClaimContext;
}
export function parseSellerClaimReceipt(value: unknown): SellerClaimReceipt | null {
  if (!record(value) || !isUuid(value.requestId) || !isUuid(value.claimId) || value.requestId !== value.claimId || !isUuid(value.orderId)
    || !Number.isSafeInteger(value.reference) || Number(value.reference) < 1 || !isOrderClaimType(value.claimType)
    || !isOrderClaimStage(value.stage) || !date(value.requestedAt) || !isUuid(value.actorId) || !nullableText(value.actorName)
    || !known(SELLER_CLAIM_SOURCES, value.source) || !(value.inquiryId === null || isUuid(value.inquiryId))
    || !date(value.customerRequestedAt) || typeof value.agreementEvidence !== 'string' || !Array.isArray(value.collections)) return null;
  if (value.claimType === 'cancel' ? value.collectionAddress !== null || value.collections.length !== 0 : !record(value.collectionAddress) || value.collections.length === 0) return null;
  for (const row of value.collections) {
    if (!record(row) || !isUuid(row.shipmentId) || !isUuid(row.originId) || typeof row.originName !== 'string' || !parseItems(row.items)
      || !known(SELLER_CLAIM_COLLECTION_METHODS, row.method) || !nullableText(row.carrier) || !nullableText(row.trackingNumber) || typeof row.note !== 'string') return null;
  }
  if (new Set(value.collections.map(row => row.shipmentId)).size !== value.collections.length) return null;
  return { ...value, collectionAddress: value.claimType === 'cancel' ? null : readAddress(value.collectionAddress) } as unknown as SellerClaimReceipt;
}

/** Check the receipt projection as well as the DB's complete payload binding. */
export function sellerClaimReceiptMatchesInput(receipt: SellerClaimReceipt, input: unknown): boolean {
  const parsed = parseSellerClaimInput(input);
  if (!parsed.ok) return false;
  const payload = parsed.payload;
  if (receipt.requestId !== parsed.requestId || receipt.claimId !== parsed.requestId || receipt.orderId !== payload.orderId
    || receipt.claimType !== payload.claimType || receipt.source !== payload.source || receipt.inquiryId !== payload.inquiryId
    || Date.parse(receipt.customerRequestedAt) !== Date.parse(payload.customerRequestedAt)
    || receipt.agreementEvidence !== payload.agreementEvidence || receipt.collections.length !== payload.collections.length) return false;
  if (payload.collectionAddress === null ? receipt.collectionAddress !== null : receipt.collectionAddress === null
    || Object.entries(payload.collectionAddress).some(([key, value]) => receipt.collectionAddress?.[key as keyof SellerClaimAddress] !== value)) return false;
  return payload.collections.every(expected => {
    const actual = receipt.collections.find(row => row.shipmentId === expected.shipmentId);
    return actual && Object.entries(expected).every(([key, value]) => actual[key as keyof SellerClaimCollectionInput] === value);
  });
}

export function sellerClaimBlockMessage(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.includes('digital_exchange_unavailable')) return '디지털 파일은 구매 당시 파일 재다운로드와 문의·취소·환불 심사로 처리합니다. 다른 파일로 교환하지 않습니다.';
  if (reason.includes('not_cancelable')) return '발주확인과 출고지시서 출력 전의 주문만 취소 요청을 접수할 수 있습니다. 이후 요청은 고객문의로 확인해주세요.';
  if (reason.includes('not_claimable')) return '실제 발송된 배송 중 주문부터 접수할 수 있습니다. 전체 수량의 배송 배정과 이전 교환품의 수령 상태를 확인해주세요.';
  if (reason.includes('deadline_expired')) return '현재 접수 시점의 신청 기한이 지났습니다. 고객 의사표시 근거와 함께 CS 검토를 이어가세요.';
  if (reason.includes('already_requested')) return '이 주문에는 처리 중인 취소·반품·교환 요청이 있습니다.';
  if (reason.includes('reconciliation_in_progress')) return '기존 결제 취소 확인이 진행 중입니다. 해당 처리 이력을 먼저 확인해주세요.';
  if (reason.includes('already_canceled')) return '이미 취소된 주문입니다.';
  if (reason.includes('order_not_found')) return '주문을 찾을 수 없습니다.';
  return '현재 주문 상태에서는 접수할 수 없습니다. 최신 주문과 처리 이력을 확인해주세요.';
}
export function sellerClaimReceiptHref(receipt: Pick<SellerClaimReceipt, 'claimType' | 'claimId'>): string {
  return `/admin/sales/claims/${receipt.claimType === 'cancel' ? 'cancels' : receipt.claimType === 'return' ? 'returns' : 'exchanges'}/${receipt.claimId}`;
}
