import { parseOrderReshipmentHistory, type OrderReshipmentReceipt } from './orders/reshipment-items';
import { isUuid } from './uuid';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './orders/claims';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
export interface GiftClaimContext {
  reshipmentHistory?: OrderReshipmentReceipt[];
  giftId: string; isSender: boolean; isRecipient: boolean; canRequest: boolean;
  claim: { id: string; type: OrderClaimType; stage: OrderClaimStage; revision: number; requestedAt: string; isRequester: boolean; canWithdraw: boolean; refundAccountNeeded: boolean; maskedRefundAccount: string | null; reshipCarrier: string | null; reshipTrackingNumber: string | null } | null;
}
export interface GiftClaimOutcome { receipt: { operationId: string; kind: 'requested' | 'withdrawn' | 'refund_account'; claimId: string }; context: GiftClaimContext }
const nullableText = (v: unknown, max: number): v is string | null => v === null || typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export function parseGiftClaimContext(v: unknown): GiftClaimContext | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['giftId', 'isSender', 'isRecipient', 'canRequest', 'claim', ...(Object.hasOwn(v, 'reshipmentHistory') ? ['reshipmentHistory'] : [])]) || !isUuid(v.giftId) || typeof v.isSender !== 'boolean' || typeof v.isRecipient !== 'boolean' || !v.isSender && !v.isRecipient || typeof v.canRequest !== 'boolean') return null;
  if (Object.hasOwn(v, 'reshipmentHistory')) {
    const history = parseOrderReshipmentHistory(v.reshipmentHistory);
    if (!history || !v.isRecipient && history.length > 0) return null;
  }
  const c = v.claim;
  if (c !== null && (!transactionRecord(c) || !transactionExactKeys(c, ['id', 'type', 'stage', 'revision', 'requestedAt', 'isRequester', 'canWithdraw', 'refundAccountNeeded', 'maskedRefundAccount', 'reshipCarrier', 'reshipTrackingNumber'])
    || !isUuid(c.id) || !isOrderClaimType(c.type) || !isOrderClaimStage(c.stage) || !transactionInteger(c.revision) || !transactionInstant(c.requestedAt)
    || typeof c.isRequester !== 'boolean' || typeof c.canWithdraw !== 'boolean' || c.canWithdraw && !c.isRequester || typeof c.refundAccountNeeded !== 'boolean'
    || !nullableText(c.maskedRefundAccount, 100) || !nullableText(c.reshipCarrier, 80) || !nullableText(c.reshipTrackingNumber, 40)
    || !v.isSender && (c.refundAccountNeeded || c.maskedRefundAccount !== null) || !v.isRecipient && (c.reshipCarrier !== null || c.reshipTrackingNumber !== null))) return null;
  return v as unknown as GiftClaimContext;
}
export function parseGiftClaimOutcome(v: unknown): GiftClaimOutcome | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['receipt', 'context']) || !transactionRecord(v.receipt)
    || !transactionExactKeys(v.receipt, ['operationId', 'kind', 'claimId']) || !isUuid(v.receipt.operationId) || !isUuid(v.receipt.claimId)
    || !['requested', 'withdrawn', 'refund_account'].includes(String(v.receipt.kind))) return null;
  const context = parseGiftClaimContext(v.context); return context ? { receipt: v.receipt as unknown as GiftClaimOutcome['receipt'], context } : null;
}
