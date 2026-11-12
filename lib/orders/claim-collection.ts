import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export const COLLECTION_METHODS = { not_requested: '접수 후 수거 협의', seller_arranged: '판매자 별도 수거 예정', customer_sent: '구매자가 이미 발송' } as const;
export type CollectionMethod = keyof typeof COLLECTION_METHODS;
export type ClaimCollectionValues = { method: CollectionMethod; carrier: string | null; trackingNumber: string | null; evidence: string; confirmed: true };
/**
 * 회수 묶음 하나(배송 건 × 반품지, S36-040·QNA-031). 승인 때 상품 우선으로 고정한 회수 주소다 — 이름·연락처는 주소록
 * 반품지에만 있고, 출고지 반품 주소를 쓰는 묶음은 빈 문자열이다. 고객 문서에는 내부 근거·처리자를 싣지 않는다.
 */
export type ClaimReturnBundle = { bundleId: string; returnName: string; returnAddress: string; returnPhone: string; items: { name: string; qty: number }[]; collectedAt: string | null };
/**
 * reshipped는 그 배송 건을 이미 재출고해 회수 정보 정정이 잠긴 행에만 온다(TKT-166). 남은 출고지는 계속 정정한다.
 * collectionWaived는 회수 생략 결정이 있는 배송 건에만 온다. returnBundles는 DB의 회수 문서 행에 없다 — 별도 읽기 RPC
 * (read_my_claim_return_bundles·admin_read_claim_return_bundles)의 응답을 서버 액션이 행에 합쳐 화면에 넘긴다.
 * 문서에 키를 더하면 배포 순간 이전 앱의 정확 키 파서가 승인된 모든 클레임의 회수 정보를 읽지 못하기 때문이다.
 */
export type ClaimCollectionRow = { shipmentId: string; originName: string; revision: number; method: CollectionMethod; carrier: string | null; carrierLabel?: string | null; trackingNumber: string | null; evidence: string; requestedOnce: boolean; collectedAt: string | null; updatedAt: string | null; reshipped?: true; returnBundles?: ClaimReturnBundle[]; collectionWaived?: true };
export type ClaimCollectionDocument = { claimId: string; orderId: string; claimRevision: number; editable: boolean; rows: ClaimCollectionRow[]; history: { id: string; shipmentId: string; createdAt: string; method: CollectionMethod; carrier: string | null; trackingNumber: string | null; evidence: string }[] };
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const returnBundle = (v: unknown): v is ClaimReturnBundle => transactionRecord(v)
  && transactionExactKeys(v, ['bundleId', 'returnName', 'returnAddress', 'returnPhone', 'items', 'collectedAt']) && isUuid(v.bundleId)
  && typeof v.returnName === 'string' && typeof v.returnAddress === 'string' && typeof v.returnPhone === 'string' && nullableText(v.collectedAt)
  && Array.isArray(v.items) && v.items.length > 0 && v.items.every(item => transactionRecord(item) && transactionExactKeys(item, ['name', 'qty'])
    && typeof item.name === 'string' && transactionInteger(item.qty, 1));
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
  if (v.rows.some(r => !transactionRecord(r) || !transactionExactKeys(r, ['shipmentId', 'originName', 'revision', 'method', 'carrier', 'trackingNumber', 'evidence', 'requestedOnce', 'collectedAt', 'updatedAt',
      ...['carrierLabel', 'reshipped', 'returnBundles', 'collectionWaived'].filter(key => Object.hasOwn(r, key))])
    || (Object.hasOwn(r, 'reshipped') && r.reshipped !== true) || (Object.hasOwn(r, 'collectionWaived') && r.collectionWaived !== true)
    || (Object.hasOwn(r, 'returnBundles') && (!Array.isArray(r.returnBundles) || r.returnBundles.length === 0 || !r.returnBundles.every(returnBundle)))
    || !isUuid(r.shipmentId) || !transactionInteger(r.revision, 0) || typeof r.originName !== 'string' || !method(r.method) || !nullableText(r.carrier) || !nullableText(r.trackingNumber)
    || (r.carrierLabel !== undefined && !nullableText(r.carrierLabel)) || typeof r.evidence !== 'string' || typeof r.requestedOnce !== 'boolean' || !nullableText(r.collectedAt) || !nullableText(r.updatedAt))) return null;
  if (v.history.some(r => !transactionRecord(r) || !transactionExactKeys(r, ['id', 'shipmentId', 'createdAt', 'method', 'carrier', 'trackingNumber', 'evidence']) || !isUuid(r.id) || !isUuid(r.shipmentId)
    || typeof r.createdAt !== 'string' || !method(r.method) || !nullableText(r.carrier) || !nullableText(r.trackingNumber) || typeof r.evidence !== 'string')) return null;
  return v as ClaimCollectionDocument;
}
/** 회수 주소 읽기 RPC 응답: 배송 건마다 [{ shipmentId, returnBundles }]. 묶음이 없는 배송 건은 빈 배열이다. */
export function parseClaimReturnBundles(v: unknown): Map<string, ClaimReturnBundle[]> | null {
  if (!Array.isArray(v)) return null;
  const result = new Map<string, ClaimReturnBundle[]>();
  for (const entry of v) {
    if (!transactionRecord(entry) || !transactionExactKeys(entry, ['shipmentId', 'returnBundles']) || !isUuid(entry.shipmentId)
      || !Array.isArray(entry.returnBundles) || !entry.returnBundles.every(returnBundle) || result.has(entry.shipmentId)) return null;
    result.set(entry.shipmentId, entry.returnBundles);
  }
  return result;
}
/** 회수 문서(행 키 불변)에 회수 주소를 합친다. 묶음이 없는 행은 키를 더하지 않는다. */
export function withClaimReturnBundles(document: ClaimCollectionDocument, bundles: Map<string, ClaimReturnBundle[]>): ClaimCollectionDocument {
  return { ...document, rows: document.rows.map(row => { const found = bundles.get(row.shipmentId); return found?.length ? { ...row, returnBundles: found } : row; }) };
}
export function claimCollectionError(code?: string, message?: string) {
  if (code === '42501') return '로그인 계정과 회수 정보 관리 권한을 다시 확인해주세요.';
  if (message === 'claim_collection_already_started') return '수거가 시작된 이력은 미요청으로 되돌릴 수 없습니다. 택배사와 송장 오류만 정정해주세요.';
  if (code === 'PT409') return '클레임 진행 상태 또는 회수 정보가 바뀌었습니다. 최신 내용을 다시 확인해주세요.';
  if (code === '22023') return '수거 방법·택배사·송장과 정정 근거를 확인해주세요.';
  return '처리 결과를 확인하지 못했습니다. 같은 요청으로 저장 결과를 다시 확인해주세요.';
}
