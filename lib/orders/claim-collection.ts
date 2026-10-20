import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export const COLLECTION_METHODS = { not_requested: '접수 후 수거 협의', seller_arranged: '판매자 별도 수거 예정', customer_sent: '구매자가 이미 발송' } as const;
export type CollectionMethod = keyof typeof COLLECTION_METHODS;
export type ClaimCollectionValues = { method: CollectionMethod; carrier: string | null; trackingNumber: string | null; evidence: string; confirmed: true };
export type ClaimCollectionRow = { shipmentId: string; originName: string; revision: number; method: CollectionMethod; carrier: string | null; carrierLabel?: string | null; trackingNumber: string | null; evidence: string; requestedOnce: boolean; collectedAt: string | null; updatedAt: string | null };
export type ClaimCollectionDocument = { claimId: string; orderId: string; claimRevision: number; editable: boolean; rows: ClaimCollectionRow[]; history: { id: string; shipmentId: string; createdAt: string; method: CollectionMethod; carrier: string | null; trackingNumber: string | null; evidence: string }[] };
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const method = (v: unknown): v is CollectionMethod => typeof v === 'string' && Object.hasOwn(COLLECTION_METHODS, v);
export function normalizeClaimCollectionValues(v: unknown): ClaimCollectionValues | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['method', 'carrier', 'trackingNumber', 'evidence', 'confirmed']) || !method(v.method)
    || !nullableText(v.carrier) || !nullableText(v.trackingNumber) || typeof v.evidence !== 'string' || v.confirmed !== true) return null;
  const carrier = (v.carrier as string | null)?.trim() || null, trackingNumber = (v.trackingNumber as string | null)?.trim().toUpperCase() || null, evidence = v.evidence.trim();
  if (evidence.length < 2 || evidence.length > 500 || /[\u0000-\u001f\u007f]/u.test(evidence) || Boolean(carrier) !== Boolean(trackingNumber)
    || carrier && carrier.length > 40 || trackingNumber && !/^[A-Z0-9]{8,40}$/u.test(trackingNumber) || v.method === 'not_requested' && carrier || v.method === 'customer_sent' && !carrier) return null;
  return { method: v.method, carrier, trackingNumber, evidence, confirmed: true };
}
export function parseClaimCollectionDocument(v: unknown): ClaimCollectionDocument | null {
  if (!transactionRecord(v) || !transactionExactKeys(v, ['claimId', 'orderId', 'claimRevision', 'editable', 'rows', 'history']) || !isUuid(v.claimId) || !isUuid(v.orderId)
    || !transactionInteger(v.claimRevision, 0) || typeof v.editable !== 'boolean' || !Array.isArray(v.rows) || !Array.isArray(v.history)) return null;
  if (v.rows.some(r => !transactionRecord(r) || !transactionExactKeys(r, ['shipmentId', 'originName', 'revision', 'method', 'carrier', 'trackingNumber', 'evidence', 'requestedOnce', 'collectedAt', 'updatedAt', ...(Object.hasOwn(r, 'carrierLabel') ? ['carrierLabel'] : [])])
    || !isUuid(r.shipmentId) || !transactionInteger(r.revision, 0) || typeof r.originName !== 'string' || !method(r.method) || !nullableText(r.carrier) || !nullableText(r.trackingNumber)
    || (r.carrierLabel !== undefined && !nullableText(r.carrierLabel)) || typeof r.evidence !== 'string' || typeof r.requestedOnce !== 'boolean' || !nullableText(r.collectedAt) || !nullableText(r.updatedAt))) return null;
  if (v.history.some(r => !transactionRecord(r) || !transactionExactKeys(r, ['id', 'shipmentId', 'createdAt', 'method', 'carrier', 'trackingNumber', 'evidence']) || !isUuid(r.id) || !isUuid(r.shipmentId)
    || typeof r.createdAt !== 'string' || !method(r.method) || !nullableText(r.carrier) || !nullableText(r.trackingNumber) || typeof r.evidence !== 'string')) return null;
  return v as ClaimCollectionDocument;
}
export function claimCollectionError(code?: string, message?: string) {
  if (code === '42501') return '로그인 계정과 회수 정보 관리 권한을 다시 확인해주세요.';
  if (message === 'claim_collection_already_started') return '수거가 시작된 이력은 미요청으로 되돌릴 수 없습니다. 택배사와 송장 오류만 정정해주세요.';
  if (code === 'PT409') return '클레임 진행 상태 또는 회수 정보가 바뀌었습니다. 최신 내용을 다시 확인해주세요.';
  if (code === '22023') return '수거 방법·택배사·송장과 정정 근거를 확인해주세요.';
  return '처리 결과를 확인하지 못했습니다. 같은 요청으로 저장 결과를 다시 확인해주세요.';
}
