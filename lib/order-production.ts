import { transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
import { isUuid } from './uuid';
export interface ProductionTerms { version: 1; goodId: string; revision: number; leadDays: number; dayBasis: 'calendar' | 'business'; closedDates: string[]; publicNote: string }
export interface GoodsProductionPolicy extends Omit<ProductionTerms, 'version' | 'leadDays'> { enabled: boolean; leadDays: number | null; evidence: string; updatedAt: string }
export type ProductionState = 'pending' | 'started' | 'completed' | 'canceled';
export interface ProductionJob {
 id: string; itemId: string; claimId: string | null; goodId: string; goodName: string; quantity: number; revision: number; state: ProductionState;
 terms: ProductionTerms; basisAt: string | null; dueAt: string | null; startedAt: string | null; completedAt: string | null; canStart: boolean; canComplete: boolean;
 history: { id: string; kind: 'start' | 'complete'; at: string; evidence: string }[];
}
export interface OrderProduction { orderId: string; cancelReviewRequired: boolean; canCancel: boolean; jobs: ProductionJob[] }
export const PRODUCTION_STATE_LABELS: Record<ProductionState, string> = { pending: '제작 대기', started: '제작 중', completed: '제작 완료', canceled: '취소됨' };
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instantOrNull = (v: unknown) => v === null || transactionInstant(v);
const days = (v: unknown) => Array.isArray(v) && v.length <= 1000 && v.every(date) && new Set(v).size === v.length;
const shortText = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
export function parseProductionTerms(v: unknown): ProductionTerms | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['version', 'goodId', 'revision', 'leadDays', 'dayBasis', 'closedDates', 'publicNote']) || v.version !== 1
  || !transactionGoodId(v.goodId) || !transactionInteger(v.revision, 1) || !transactionInteger(v.leadDays, 1, 365) || !['calendar', 'business'].includes(String(v.dayBasis)) || !days(v.closedDates) || !shortText(v.publicNote)
  || v.dayBasis === 'calendar' && (v.closedDates as string[]).length > 0) return null;
 return v as unknown as ProductionTerms;
}
export function parseGoodsProductionPolicy(v: unknown): GoodsProductionPolicy | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['goodId', 'revision', 'enabled', 'leadDays', 'dayBasis', 'closedDates', 'publicNote', 'evidence', 'updatedAt'])
  || !transactionGoodId(v.goodId) || !transactionInteger(v.revision, 0) || typeof v.enabled !== 'boolean' || !shortText(v.evidence) || !transactionInstant(v.updatedAt)
  || v.leadDays !== null && !transactionInteger(v.leadDays, 1, 365) || v.enabled && v.leadDays === null
  || !['calendar', 'business'].includes(String(v.dayBasis)) || !days(v.closedDates) || !shortText(v.publicNote) || v.dayBasis === 'calendar' && (v.closedDates as string[]).length > 0) return null;
 return v as unknown as GoodsProductionPolicy;
}
export function parseOrderProduction(v: unknown): OrderProduction | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['orderId', 'cancelReviewRequired', 'canCancel', 'jobs']) || !isUuid(v.orderId) || typeof v.cancelReviewRequired !== 'boolean' || typeof v.canCancel !== 'boolean' || !Array.isArray(v.jobs)) return null;
 const ids = new Set<string>();
 for (const j of v.jobs) {
  if (!transactionRecord(j) || !transactionExactKeys(j, ['id', 'itemId', 'claimId', 'goodId', 'goodName', 'quantity', 'revision', 'state', 'terms', 'basisAt', 'dueAt', 'startedAt', 'completedAt', 'canStart', 'canComplete', 'history'])
   || !isUuid(j.id) || ids.has(j.id) || !isUuid(j.itemId) || j.claimId !== null && !isUuid(j.claimId) || !transactionGoodId(j.goodId) || !shortText(j.goodName, 500)
   || !transactionInteger(j.quantity, 1) || !transactionInteger(j.revision, 1) || !['pending', 'started', 'completed', 'canceled'].includes(String(j.state))
   || parseProductionTerms(j.terms)?.goodId !== j.goodId || ![j.basisAt, j.dueAt, j.startedAt, j.completedAt].every(instantOrNull)
   || (j.basisAt === null) !== (j.dueAt === null) || typeof j.canStart !== 'boolean' || typeof j.canComplete !== 'boolean'
   || !Array.isArray(j.history) || j.history.some(h => !transactionRecord(h) || !transactionExactKeys(h, ['id', 'kind', 'at', 'evidence']) || !isUuid(h.id) || !['start', 'complete'].includes(String(h.kind)) || !transactionInstant(h.at) || !shortText(h.evidence))) return null;
  ids.add(j.id);
 }
 return v as unknown as OrderProduction;
}
export function productionLeadLabel(terms: ProductionTerms) { return `${terms.leadDays}${terms.dayBasis === 'calendar' ? '일' : '영업일(토·일·설정 휴무일 제외)'}`; }
export function productionError(code?: string, message?: string) {
 const known: Record<string, string> = { production_changed: '제작 정보가 변경됐습니다. 최신 상태를 확인해주세요.', production_terms_changed: '주문제작 조건이 바뀌었습니다. 주문서를 다시 확인해주세요.', production_preorder_conflict: '예약판매를 일반 재고 판매로 전환한 뒤 주문제작을 설정해주세요.', production_incomplete: '제작 완료를 확인한 뒤 출고지시·발송·교환 재출고를 진행해주세요.', production_transition_unavailable: '결제·취소 요청·현재 제작 단계를 확인해주세요.', production_requires_transaction: '이 상품은 새 주문서에서 주문제작 조건을 확인한 뒤 구매할 수 있습니다.' };
 return known[message ?? ''] ?? (code === 'PT409' ? '다른 작업으로 상태가 바뀌었습니다. 최신 상태를 확인해주세요.' : code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === '22023' ? '기간·휴무일·처리 근거를 확인해주세요.' : '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');
}

export interface ShipmentProductionSummary { count: number; completed: number; ready: boolean; dueAt: string | null }
export function parseShipmentProductionSummary(v: unknown): ShipmentProductionSummary | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['count', 'completed', 'ready', 'dueAt']) || !transactionInteger(v.count, 0) || !transactionInteger(v.completed, 0, v.count) || v.ready !== (v.completed === v.count) || !instantOrNull(v.dueAt)) return null;
 return v as unknown as ShipmentProductionSummary;
}
