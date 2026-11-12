import { orderReshipmentParcelViews, parseOrderReshipmentHistory, parseOrderReshipmentParcels, type OrderReshipmentParcel, type OrderReshipmentParcelView, type OrderReshipmentReceipt } from './orders/reshipment-items';
import type { ShippingCarrierRegistry } from './orders/shipment';
import { isUuid } from './uuid';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './orders/claims';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
export interface GiftClaimContext {
  reshipmentHistory?: OrderReshipmentReceipt[];
  /**
   * 선물 받은 분에게만 오는 교환 소포(배송 건마다 하나, TKT-166·ADR-0041). DB는 배송 건 재출고 기록이 있을 때만
   * 이 키를 싣는다 — 이 키를 모르는 옛 앱 파서(정확한 키)가 배포 틈에 기존 선물을 읽지 못하는 일이 없게 한다.
   * 서버가 택배사 레지스트리로 표시 이름·배송조회 링크를 붙여 화면에 넘긴다(giftClaimContextView).
   */
  reshipmentParcels?: OrderReshipmentParcelView[];
  giftId: string; isSender: boolean; isRecipient: boolean; canRequest: boolean;
  claim: { id: string; type: OrderClaimType; stage: OrderClaimStage; revision: number; requestedAt: string; isRequester: boolean; canWithdraw: boolean; refundAccountNeeded: boolean; maskedRefundAccount: string | null; reshipCarrier: string | null; reshipTrackingNumber: string | null } | null;
}
/** DB가 돌려준 그대로의 문맥. 소포는 아직 택배사 표시 이름·조회 링크가 붙지 않았다. */
export type GiftClaimContextData = Omit<GiftClaimContext, 'reshipmentParcels'> & { reshipmentParcels?: OrderReshipmentParcel[] };
type GiftClaimReceipt = { operationId: string; kind: 'requested' | 'withdrawn' | 'refund_account'; claimId: string };
export interface GiftClaimOutcome { receipt: GiftClaimReceipt; context: GiftClaimContext }
export interface GiftClaimOutcomeData { receipt: GiftClaimReceipt; context: GiftClaimContextData }
const nullableText = (v: unknown, max: number): v is string | null => v === null || typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export function parseGiftClaimContext(v: unknown): GiftClaimContextData | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['giftId', 'isSender', 'isRecipient', 'canRequest', 'claim',
    ...(Object.hasOwn(v, 'reshipmentHistory') ? ['reshipmentHistory'] : []), ...(Object.hasOwn(v, 'reshipmentParcels') ? ['reshipmentParcels'] : [])])
    || !isUuid(v.giftId) || typeof v.isSender !== 'boolean' || typeof v.isRecipient !== 'boolean' || !v.isSender && !v.isRecipient || typeof v.canRequest !== 'boolean') return null;
  if (Object.hasOwn(v, 'reshipmentHistory')) {
    const history = parseOrderReshipmentHistory(v.reshipmentHistory);
    if (!history || !v.isRecipient && history.length > 0) return null;
  }
  /* 보낸 분(결제자)에게는 받는 분의 배송 정보를 싣지 않는다 — 소포 목록도 받는 분만이다. */
  if (Object.hasOwn(v, 'reshipmentParcels')) {
    const parcels = parseOrderReshipmentParcels(v.reshipmentParcels);
    if (!parcels || !v.isRecipient && parcels.length > 0) return null;
  }
  const c = v.claim;
  if (c !== null && (!transactionRecord(c) || !transactionExactKeys(c, ['id', 'type', 'stage', 'revision', 'requestedAt', 'isRequester', 'canWithdraw', 'refundAccountNeeded', 'maskedRefundAccount', 'reshipCarrier', 'reshipTrackingNumber'])
    || !isUuid(c.id) || !isOrderClaimType(c.type) || !isOrderClaimStage(c.stage) || !transactionInteger(c.revision) || !transactionInstant(c.requestedAt)
    || typeof c.isRequester !== 'boolean' || typeof c.canWithdraw !== 'boolean' || c.canWithdraw && !c.isRequester || typeof c.refundAccountNeeded !== 'boolean'
    || !nullableText(c.maskedRefundAccount, 100) || !nullableText(c.reshipCarrier, 80) || !nullableText(c.reshipTrackingNumber, 40)
    || !v.isSender && (c.refundAccountNeeded || c.maskedRefundAccount !== null) || !v.isRecipient && (c.reshipCarrier !== null || c.reshipTrackingNumber !== null))) return null;
  return v as unknown as GiftClaimContextData;
}
export function parseGiftClaimOutcome(v: unknown): GiftClaimOutcomeData | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['receipt', 'context']) || !transactionRecord(v.receipt)
    || !transactionExactKeys(v.receipt, ['operationId', 'kind', 'claimId']) || !isUuid(v.receipt.operationId) || !isUuid(v.receipt.claimId)
    || !['requested', 'withdrawn', 'refund_account'].includes(String(v.receipt.kind))) return null;
  const context = parseGiftClaimContext(v.context); return context ? { receipt: v.receipt as unknown as GiftClaimReceipt, context } : null;
}
/** 화면에 넘길 문맥: 소포에 택배사 표시 이름과 배송조회 링크를 붙인다. 소포 키가 없던 문맥은 그대로다. */
export function giftClaimContextView(context: GiftClaimContextData, carriers: ShippingCarrierRegistry): GiftClaimContext {
  const { reshipmentParcels, ...rest } = context;
  return reshipmentParcels ? { ...rest, reshipmentParcels: orderReshipmentParcelViews(reshipmentParcels, carriers) } : rest;
}
