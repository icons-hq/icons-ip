import { isUuid } from './uuid';
import { normalizeCheckoutAddress, normalizeCheckoutPaymentMethod, type CheckoutAddress, type CheckoutPaymentMethod } from './checkout';
import { parseGoodsCustomInputSelection, type GoodsCustomInputSelection } from './goods-custom-inputs';
import { parseGoodsTransactionSelection, type GoodsTransactionSelection } from './goods-transaction';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';

export const GIFT_MESSAGE_LIMIT = 300;
export const GIFT_CLAIM_COOKIE = 'icons_gift_claim';
export const GIFT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const GIFT_STATES = ['awaiting_acceptance', 'accepted', 'ordered', 'declined', 'expired', 'canceled'] as const;
export type GiftState = typeof GIFT_STATES[number];
export type GiftParty = 'sender' | 'recipient';
export interface GiftItem { goodId: string; variantId: string; name: string; variantName: string; qty: number; imagePath: string | null; customInputs: GoodsCustomInputSelection | null }
export interface GiftInvitation { id: string; revision: number; message: string; senderLabel: string; expiresAt: string; items: GiftItem[] }
export interface GiftShipment { id: string; status: 'ready' | 'shipping' | 'delivered' | 'canceled'; shippedAt: string | null; deliveredAt: string | null; expectedShipDate: string | null; carrier: string | null; trackingNumber: string | null }
export interface GiftOrder { id: string; status: string; createdAt: string; expiresAt: string | null; total: number | null; paymentMethod: CheckoutPaymentMethod | null }
export interface GiftDetail extends GiftInvitation {
  party: GiftParty; isRecipient: boolean; state: GiftState; recipientLabel: string | null; createdAt: string; acceptedAt: string | null;
  address: CheckoutAddress | null; addressRevision: number | null; order: GiftOrder | null; shipments: GiftShipment[];
}
export interface GiftPage { items: GiftDetail[]; hasMore: boolean }
export interface GiftFailure { error: string; uncertain?: boolean; conflict?: boolean }

const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const text = (value: unknown, max = 300): value is string => typeof value === 'string' && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const nullableText = (value: unknown, max = 300): value is string | null => value === null || text(value, max);
const instant = (value: unknown): value is string => transactionInstant(value);
const nullableInstant = (value: unknown): value is string | null => value === null || instant(value);

function parseGiftItems(value: unknown): GiftItem[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null;
  const result: GiftItem[] = [];
  for (const row of value) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['goodId', 'variantId', 'name', 'variantName', 'qty', 'imagePath', 'customInputs'])
      || !text(row.goodId, 200) || !row.goodId || !uuid(row.variantId) || !text(row.name, 200) || !row.name
      || !text(row.variantName, 200) || !transactionInteger(row.qty, 1, 2147483647) || !nullableText(row.imagePath, 1000)) return null;
    const customInputs = row.customInputs === null ? null : parseGoodsCustomInputSelection(row.customInputs);
    if (row.customInputs !== null && !customInputs) return null;
    result.push({ goodId: row.goodId, variantId: row.variantId, name: row.name, variantName: row.variantName, qty: row.qty, imagePath: row.imagePath, customInputs });
  }
  return result;
}

const INVITATION_KEYS = ['id', 'revision', 'message', 'senderLabel', 'expiresAt', 'items'];
export function parseGiftInvitation(value: unknown): GiftInvitation | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, INVITATION_KEYS)
    || !uuid(value.id) || !transactionInteger(value.revision, 1) || !text(value.message, GIFT_MESSAGE_LIMIT)
    || !text(value.senderLabel, 100) || !value.senderLabel || !instant(value.expiresAt)) return null;
  const items = parseGiftItems(value.items); if (!items) return null;
  return { id: value.id, revision: value.revision, message: value.message, senderLabel: value.senderLabel, expiresAt: value.expiresAt, items };
}

export function parseGiftDetail(value: unknown): GiftDetail | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, [...INVITATION_KEYS, 'party', 'isRecipient', 'state', 'recipientLabel', 'createdAt', 'acceptedAt', 'address', 'addressRevision', 'order', 'shipments'])
    || typeof value.isRecipient !== 'boolean' || !['sender', 'recipient'].includes(String(value.party)) || !GIFT_STATES.includes(value.state as GiftState)
    || !nullableText(value.recipientLabel, 100) || !instant(value.createdAt) || !nullableInstant(value.acceptedAt)
    || !(value.addressRevision === null || transactionInteger(value.addressRevision, 0)) || !Array.isArray(value.shipments) || value.shipments.length > 100) return null;
  const invitation = parseGiftInvitation(Object.fromEntries(INVITATION_KEYS.map(key => [key, value[key]])));
  if (!invitation) return null;
  const address = value.address === null ? null : normalizeCheckoutAddress(value.address);
  if (value.address !== null && !address || (address === null) !== (value.addressRevision === null) || !value.isRecipient && address !== null) return null;
  let order: GiftOrder | null = null;
  if (value.order !== null) {
    const row = value.order;
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'status', 'createdAt', 'expiresAt', 'total', 'paymentMethod'])
      || !uuid(row.id) || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(row.status))
      || !instant(row.createdAt) || !nullableInstant(row.expiresAt)) return null;
    const paymentMethod = normalizeCheckoutPaymentMethod(row.paymentMethod);
    if (value.party === 'recipient' ? row.total !== null || row.paymentMethod !== null : !transactionInteger(row.total) || !paymentMethod) return null;
    order = { id: row.id, status: row.status as string, createdAt: row.createdAt, expiresAt: row.expiresAt, total: row.total as number | null, paymentMethod };
  }
  const shipments: GiftShipment[] = []; const ids = new Set<string>();
  for (const row of value.shipments) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'status', 'shippedAt', 'deliveredAt', 'expectedShipDate', 'carrier', 'trackingNumber'])
      || !uuid(row.id) || ids.has(row.id) || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(row.status))
      || !nullableInstant(row.shippedAt) || !nullableInstant(row.deliveredAt)
      || !(row.expectedShipDate === null || typeof row.expectedShipDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.expectedShipDate))
      || !nullableText(row.carrier, 80) || !nullableText(row.trackingNumber, 40) || !value.isRecipient && (row.carrier !== null || row.trackingNumber !== null)) return null;
    ids.add(row.id); shipments.push(row as unknown as GiftShipment);
  }
  if (order === null && shipments.length || value.state === 'ordered' && order === null) return null;
  return { ...invitation, party: value.party as GiftParty, isRecipient: value.isRecipient, state: value.state as GiftState, recipientLabel: value.recipientLabel, createdAt: value.createdAt,
    acceptedAt: value.acceptedAt, address, addressRevision: value.addressRevision as number | null, order, shipments };
}

export interface GiftReceipt { operationId: string; kind: 'created' | 'link_issued' | 'responded' | 'address_changed' | 'closed'; revision: number }
export interface GiftOutcome { gift: GiftDetail; receipt: GiftReceipt }
export function parseGiftOutcome(value: unknown): GiftOutcome | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['gift', 'receipt']) || !transactionRecord(value.receipt)
    || !transactionExactKeys(value.receipt, ['operationId', 'kind', 'revision']) || !uuid(value.receipt.operationId)
    || !['created', 'link_issued', 'responded', 'address_changed', 'closed'].includes(String(value.receipt.kind)) || !transactionInteger(value.receipt.revision, 1)) return null;
  const gift = parseGiftDetail(value.gift); if (!gift || gift.revision < value.receipt.revision) return null;
  return { gift, receipt: value.receipt as unknown as GiftReceipt };
}

export function parseGiftPage(value: unknown): GiftPage | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['items', 'hasMore']) || !Array.isArray(value.items) || value.items.length > 20 || typeof value.hasMore !== 'boolean') return null;
  const items = value.items.map(parseGiftDetail); if (items.some(item => !item) || new Set(items.map(item => item?.id)).size !== items.length) return null;
  return { items: items as GiftDetail[], hasMore: value.hasMore };
}

export function giftSelectionFromCart(items: readonly { goodId: string; variantId: string; qty: number; customInputs?: GoodsCustomInputSelection }[]): GoodsTransactionSelection[] | null {
  if (items.length > 100) return null;
  return parseGoodsTransactionSelection(items.map(item => ({ goodId: item.goodId, variantId: item.variantId, qty: item.qty, inputRevision: item.customInputs?.revision ?? 0,
    inputValues: Object.fromEntries(item.customInputs?.fields.map(field => [field.id, field.value]) ?? []) })));
}

export function giftInvitationUrl(origin: string, token: string): string {
  if (!GIFT_TOKEN_PATTERN.test(token)) throw new Error('gift_link_invalid');
  return `${new URL(origin).origin}/gifts/receive#token=${token}`;
}

export function giftStateLabel(state: GiftState, orderStatus?: string): string {
  if (state === 'ordered') return ({ pending: '결제 대기', paid: '결제 완료', confirmed: '굿즈 준비', shipping: '배송 중', delivered: '배송 완료', done: '선물 전달 완료', canceled: '주문 취소' } as Record<string, string>)[orderStatus ?? ''] ?? '주문 접수';
  return { awaiting_acceptance: '수락 기다림', accepted: '결제 기다림', ordered: '주문 진행 중', declined: '수락 거절', expired: '기한 만료', canceled: '선물 취소' }[state];
}

export function giftError(error?: { code?: string; message?: string }): GiftFailure {
  if (error?.code === 'PT409') return { error: '선물 상태가 바뀌었습니다. 입력을 보관한 뒤 최신 상태를 확인해주세요.', conflict: true };
  const messages: Record<string, string> = {
    gift_auth_changed: '로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.', gift_auth_required: '로그인 후 다시 확인해주세요.',
    gift_account_unavailable: '현재 계정 상태로 새 선물을 준비하거나 수락할 수 없습니다.', gift_not_available: '지금은 새 선물을 준비할 수 없습니다.',
    gift_not_found: '이 선물을 확인할 수 없습니다.', gift_open_limit: '진행 중인 선물을 확인한 뒤 새 선물을 준비해주세요.',
    gift_invitation_unavailable: '사용할 수 없는 선물 링크입니다. 보낸 사람에게 새 링크를 요청해주세요.',
    gift_link_closed: '이미 수락했거나 기한이 지난 선물의 링크는 다시 발급할 수 없습니다.', gift_response_closed: '이 선물은 더 이상 수락할 수 없습니다.',
    gift_address_closed: '주문이 시작됐거나 기한이 지나 배송지를 여기서 바꿀 수 없습니다.', gift_close_unavailable: '주문이 시작된 선물은 주문의 취소 상태를 확인해주세요.',
    gift_good_unavailable: '현재 선물할 수 없는 굿즈가 포함되어 있습니다.', gift_variant_unavailable: '현재 선물할 수 없는 옵션이 포함되어 있습니다.',
    gift_source_changed: '선물 선택이나 배송지가 바뀌었습니다. 최신 견적을 확인해주세요.', gift_address_changed: '배송지가 바뀌었습니다. 최신 견적을 확인해주세요.',
    gift_prepaid_required: '선물의 배송비는 보낸 사람이 결제해야 합니다.', gift_payment_not_ready: '받는 사람이 수락하고 배송지를 입력한 뒤 결제할 수 있습니다.',
    not_claimable: '배송 완료 후 교환·반품을 요청할 수 있습니다.', deadline_expired: '화면에서 요청할 수 있는 기간이 지났습니다. 고객센터에서 확인해주세요.',
    already_requested: '이미 진행 중인 요청이 있습니다. 최신 상태를 확인해주세요.', gift_refund_account_closed: '현재 요청 상태에서는 계좌를 입력할 수 없습니다. 최신 상태를 확인해주세요.',
    gift_refund_account_exists: '이미 확인한 계좌가 있습니다. 최신 요청 상태를 확인해주세요.',
    goods_custom_inputs_changed: '굿즈의 직접입력 항목이 바뀌었습니다. 굿즈를 다시 선택해주세요.',
  };
  if (error?.message && messages[error.message]) return { error: messages[error.message] };
  if (['22023', '23514', '23505', '23503', '42501', '28000', 'P0002', '55000'].includes(error?.code ?? '')) return { error: '입력과 현재 선물 상태를 확인해주세요. 작성한 내용은 유지됩니다.' };
  return { error: '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
}
