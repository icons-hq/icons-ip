import { isUuid } from './uuid';
import { transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
export const FULFILLMENT_METHODS = ['parcel', 'quick', 'pickup', 'direct', 'freight', 'none', 'digital'] as const;
export type FulfillmentMethod = typeof FULFILLMENT_METHODS[number];
export const FULFILLMENT_METHOD_LABELS: Record<FulfillmentMethod, string> = { parcel: '택배', quick: '퀵', pickup: '방문수령', direct: '직접배송', freight: '화물배송', none: '배송없음 · 직접전달', digital: '디지털 파일 다운로드' };
export type FulfillmentMode = 'shipping' | 'no_delivery' | 'digital';
export interface FulfillmentMethodTerms { method: FulfillmentMethod; feeAmount: number | null; feeBasis: 'per_order' | 'per_item'; installationFee: number }
export const DIGITAL_BUCKET = 'goods-digital-private';
export const DIGITAL_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const DIGITAL_MIME_EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'application/zip': 'zip', 'image/png': 'png', 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'text/plain': 'txt' };
export interface DigitalFile { id: string; name: string; mimeType: string; size: number }
export interface GoodsFulfillment { goodId: string; revision: number; mode: FulfillmentMode; methods: FulfillmentMethodTerms[]; files: DigitalFile[]; publicNote: string }
export interface GoodsFulfillmentSettings extends GoodsFulfillment { evidence: string; updatedAt: string }
export interface FulfillmentTerms { version: 1; goodId: string; revision: number; mode: FulfillmentMode; method: FulfillmentMethod; terms: FulfillmentMethodTerms; files: DigitalFile[]; publicNote: string }
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
export const fulfillmentNeedsAddress = (method: FulfillmentMethod) => ['parcel', 'quick', 'direct', 'freight'].includes(method);
export function parseDigitalFile(v: unknown): DigitalFile | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['id', 'name', 'mimeType', 'size']) || !isUuid(v.id) || !text(v.name, 160) || !v.name.trim() || /[\\/]/u.test(v.name)
  || typeof v.mimeType !== 'string' || !Object.hasOwn(DIGITAL_MIME_EXTENSIONS, v.mimeType) || !transactionInteger(v.size, 1, DIGITAL_FILE_MAX_BYTES)) return null;
 return v as unknown as DigitalFile;
}
export function parseFulfillmentMethodTerms(v: unknown): FulfillmentMethodTerms | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['method', 'feeAmount', 'feeBasis', 'installationFee']) || !FULFILLMENT_METHODS.includes(v.method as FulfillmentMethod)
  || !['per_order', 'per_item'].includes(String(v.feeBasis)) || !transactionInteger(v.installationFee, 0, 1_000_000)
  || (v.method === 'parcel' ? v.feeAmount !== null || v.feeBasis !== 'per_order' : !transactionInteger(v.feeAmount, 0, 1_000_000))
  || ['pickup', 'none', 'digital'].includes(String(v.method)) && (v.feeAmount !== 0 || v.installationFee !== 0)) return null;
 return v as unknown as FulfillmentMethodTerms;
}
export function parseGoodsFulfillment(v: unknown, internal: true): GoodsFulfillmentSettings | null;
export function parseGoodsFulfillment(v: unknown, internal?: false): GoodsFulfillment | null;
export function parseGoodsFulfillment(v: unknown, internal = false): GoodsFulfillment | GoodsFulfillmentSettings | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['goodId', 'revision', 'mode', 'methods', 'files', 'publicNote', ...(internal ? ['evidence', 'updatedAt'] : [])])
  || !transactionGoodId(v.goodId) || !transactionInteger(v.revision, 0) || !['shipping', 'no_delivery', 'digital'].includes(String(v.mode))
  || !Array.isArray(v.methods) || !v.methods.length || v.methods.length > 5 || v.methods.some(m => !parseFulfillmentMethodTerms(m))
  || new Set(v.methods.map(m => m.method)).size !== v.methods.length || !Array.isArray(v.files) || v.files.length > 10 || v.files.some(f => !parseDigitalFile(f))
  || new Set(v.files.map(f => f.id)).size !== v.files.length || !text(v.publicNote, 1000)
  || internal && (!text(v.evidence, 1000) || !transactionInstant(v.updatedAt))) return null;
 if (v.mode === 'shipping' ? v.files.length > 0 || v.methods.some(m => ['none', 'digital'].includes(m.method))
  : v.methods.length !== 1 || v.methods[0].method !== (v.mode === 'digital' ? 'digital' : 'none') || (v.mode === 'digital') !== (v.files.length > 0)) return null;
 return v as unknown as GoodsFulfillment | GoodsFulfillmentSettings;
}
export function parseFulfillmentTerms(v: unknown): FulfillmentTerms | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['version', 'goodId', 'revision', 'mode', 'method', 'terms', 'files', 'publicNote']) || v.version !== 1
  || !transactionInteger(v.revision, 1) || !parseFulfillmentMethodTerms(v.terms) || (v.terms as FulfillmentMethodTerms).method !== v.method
  || !parseGoodsFulfillment({ goodId: v.goodId, revision: v.revision, mode: v.mode, methods: [v.terms], files: v.files, publicNote: v.publicNote })) return null;
 return v as unknown as FulfillmentTerms;
}
export function fulfillmentError(code?: string, message?: string) {
 const known: Record<string, string> = { fulfillment_changed: '다른 담당자가 설정을 변경했습니다. 최신 설정을 확인해주세요.', digital_asset_unavailable: '파일 확인이 끝나지 않았거나 사용할 수 없는 파일입니다.', digital_supply_conflict: '디지털 파일 상품은 예약판매·주문제작을 해제한 뒤 설정해주세요.', digital_upload_budget: '진행 중인 파일 업로드를 마친 뒤 잠시 후 다시 시도해주세요.', digital_upload_expired: '업로드 준비 시간이 지났습니다. 파일을 다시 선택해주세요.', digital_access_unavailable: '현재 계정과 결제·환불 상태로 파일을 받을 수 없습니다.' };
 return known[message ?? ''] ?? (code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === 'PT409' ? '설정이나 요청 내용이 변경됐습니다. 최신 상태를 확인해주세요.' : code?.startsWith('22') ? '배송 방식·비용·파일·처리 근거를 확인해주세요.' : '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');
}
