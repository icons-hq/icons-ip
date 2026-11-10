import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
import { isUuid } from './uuid';
export const PURCHASE_CONFIRMATION_POLICY_PATH = '/admin/sales/settled/policy';
export const CONFIRMATION_EVENT_LABELS = { request: '구매확정 요청', hold: '구매확정 보류', resume: '보류 해제', extend: '구매자 기간 연장', confirm: '구매자 직접 확정', automatic: '정책에 따른 자동 확정' } as const;
export type ConfirmationEventKind = keyof typeof CONFIRMATION_EVENT_LABELS;
export interface PurchaseConfirmationPolicy { revision: number; autoEnabled: boolean; autoAfterDays: number | null; buyerExtensionDays: number | null; evidence: string; updatedAt: string }
export interface PurchaseConfirmation { orderId: string; revision: number; status: string; confirmedAt: string | null; confirmationKind: 'buyer' | 'automatic' | null;
  autoDueAt: string | null; automaticActive: boolean; held: boolean; holdReason: string | null; extensionUsed: boolean; extensionDays: number | null; requestedAt: string | null;
  canConfirm: boolean; canExtend: boolean; history: { id: string; kind: ConfirmationEventKind; note: string; at: string }[] }
const nullableInstant = (v: unknown): v is string | null => v === null || transactionInstant(v);
const days = (v: unknown): v is number | null => v === null || transactionInteger(v, 1, 36500);
export function parsePurchaseConfirmationPolicy(v: unknown): PurchaseConfirmationPolicy | null {
  return transactionRecord(v) && transactionExactKeys(v, ['revision', 'autoEnabled', 'autoAfterDays', 'buyerExtensionDays', 'evidence', 'updatedAt'])
    && transactionInteger(v.revision, 1) && typeof v.autoEnabled === 'boolean' && days(v.autoAfterDays) && days(v.buyerExtensionDays)
    && (!v.autoEnabled || v.autoAfterDays !== null) && typeof v.evidence === 'string' && v.evidence.length <= 2000 && transactionInstant(v.updatedAt) ? v as unknown as PurchaseConfirmationPolicy : null;
}
export function parsePurchaseConfirmation(v: unknown): PurchaseConfirmation | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['orderId', 'revision', 'status', 'confirmedAt', 'confirmationKind', 'autoDueAt', 'automaticActive', 'held', 'holdReason', 'extensionUsed', 'extensionDays', 'requestedAt', 'canConfirm', 'canExtend', 'history'])
    || !isUuid(v.orderId) || !transactionInteger(v.revision) || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(v.status))
    || !nullableInstant(v.confirmedAt) || !nullableInstant(v.autoDueAt) || !nullableInstant(v.requestedAt) || ![null, 'buyer', 'automatic'].includes(v.confirmationKind as string | null)
    || !days(v.extensionDays) || v.holdReason !== null && (typeof v.holdReason !== 'string' || v.holdReason.length > 500)
    || ['automaticActive', 'held', 'extensionUsed', 'canConfirm', 'canExtend'].some(k => typeof v[k] !== 'boolean') || !Array.isArray(v.history)) return null;
  if (v.history.some(e => !transactionRecord(e) || !transactionExactKeys(e, ['id', 'kind', 'note', 'at']) || !isUuid(e.id) || typeof e.kind !== 'string'
    || !Object.hasOwn(CONFIRMATION_EVENT_LABELS, e.kind) || typeof e.note !== 'string' || e.note.length > 500 || !transactionInstant(e.at))
    || new Set(v.history.map(e => e.id)).size !== v.history.length || v.canConfirm && (v.status !== 'delivered' || v.held)
    || v.canExtend && (!v.canConfirm || !v.automaticActive || v.extensionUsed || v.extensionDays === null)) return null;
  return v as unknown as PurchaseConfirmation;
}
export function purchaseConfirmationError(code?: string, message?: string) {
  if (['42501', '28000'].includes(code ?? '')) return '현재 로그인 계정과 주문 관리 권한을 확인해주세요.';
  if (code === 'PT409') return '주문 처리 상태가 바뀌었습니다. 현재 상태를 다시 불러와주세요.';
  if (message?.includes('unavailable') || message?.includes('held') || message?.includes('already_requested')) return '이미 처리됐거나 현재 주문 상태에서 진행할 수 없습니다. 현재 상태를 확인해주세요.';
  return '처리 결과를 확인하지 못했습니다. 다시 실행하기 전에 현재 상태를 불러와주세요.';
}
