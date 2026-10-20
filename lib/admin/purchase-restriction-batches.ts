import { isUuid } from '@/lib/uuid';
import { PURCHASE_RESTRICTION_REASONS, type PurchaseRestrictionReason } from './purchase-restrictions';
export const PURCHASE_RESTRICTION_BATCH_LIMIT = 100;
export const PURCHASE_RESTRICTION_BATCH_INPUT_MAX = 26000;
export type PurchaseRestrictionBatchMode = 'customer' | 'order';
export type PurchaseRestrictionPreviewStatus = 'ready' | 'duplicate' | 'invalid_input' | 'not_found' | 'ambiguous' | 'not_eligible' | 'already_active';
export interface PurchaseRestrictionBatchRow {
  rowNumber: number; input: string; userId: string | null; nickname: string | null; maskedEmail: string | null;
  evidenceOrderId: string | null; status: PurchaseRestrictionPreviewStatus; duplicateOf: number | null; restrictionId: string | null;
  outcome: 'registered' | 'skipped' | 'failed' | null; error: string | null; currentState: 'active' | 'released' | 'missing' | null; releasedAt: string | null;
}
export interface PurchaseRestrictionBatch {
  id: string; mode: PurchaseRestrictionBatchMode; reasonCode: PurchaseRestrictionReason; reasonDetail: string;
  createdAt: string; expiresAt: string; completedAt: string | null; status: 'prepared' | 'expired' | 'completed'; canExecute: boolean;
  readyCount: number; registeredCount: number; skippedCount: number; failedCount: number; rows: PurchaseRestrictionBatchRow[];
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalUuid = (value: unknown) => value === null || isUuid(value);
export function splitPurchaseRestrictionTargets(raw: string): { ok: true; targets: string[] } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length > PURCHASE_RESTRICTION_BATCH_INPUT_MAX) return { ok: false, error: `입력은 ${PURCHASE_RESTRICTION_BATCH_INPUT_MAX.toLocaleString('ko-KR')}자 이내입니다.` };
  const targets = raw.split(/[,\r\n]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!targets.length || targets.length > PURCHASE_RESTRICTION_BATCH_LIMIT) return { ok: false, error: '한 번에 1~100개를 입력해주세요. 줄바꿈 또는 쉼표로 구분합니다.' };
  if (targets.some(value => value.length > 254 || /[\u0000-\u001f\u007f]/.test(value))) return { ok: false, error: '각 식별자는 254자 이내로 입력해주세요. 줄바꿈·쉼표 외 제어 문자는 사용할 수 없습니다.' };
  // Keep duplicates as distinct rows: the server resolves UUID/email aliases to
  // the same customer and explains which earlier row represents that customer.
  return { ok: true, targets };
}
export function parsePurchaseRestrictionBatchForm(form: FormData) {
  const value = (name: string) => typeof form.get(name) === 'string' ? String(form.get(name)).trim() : '';
  const id = value('batchId'); const mode = value('mode'); const reasonCode = value('reasonCode'); const reasonDetail = value('reasonDetail');
  const errors: Record<string, string> = {}; const parsed = splitPurchaseRestrictionTargets(value('targets'));
  if (!isUuid(id)) errors.form = '대상 확인을 다시 시작해주세요.';
  if (mode !== 'customer' && mode !== 'order') errors.mode = '입력 방식을 선택해주세요.';
  if (!PURCHASE_RESTRICTION_REASONS.some(item => item.value === reasonCode)) errors.reasonCode = '등록 사유를 선택해주세요.';
  if (!reasonDetail || reasonDetail.length > 200) errors.reasonDetail = '상세 사유를 1~200자로 입력해주세요.';
  if (!parsed.ok) errors.targets = parsed.error;
  if (Object.keys(errors).length || !parsed.ok) return { ok: false as const, errors };
  return { ok: true as const, id, mode: mode as PurchaseRestrictionBatchMode, reasonCode: reasonCode as PurchaseRestrictionReason, reasonDetail, targets: parsed.targets };
}
export function parsePurchaseRestrictionBatch(value: unknown): PurchaseRestrictionBatch | null {
  if (!record(value) || !isUuid(value.id) || !['customer', 'order'].includes(String(value.mode))
    || !PURCHASE_RESTRICTION_REASONS.some(item => item.value === value.reasonCode) || typeof value.reasonDetail !== 'string'
    || !value.reasonDetail || value.reasonDetail.length > 200 || !date(value.createdAt) || !date(value.expiresAt)
    || !['prepared', 'expired', 'completed'].includes(String(value.status)) || typeof value.canExecute !== 'boolean'
    || (value.completedAt !== null && !date(value.completedAt))
    || ![value.readyCount, value.registeredCount, value.skippedCount, value.failedCount].every(integer)
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > PURCHASE_RESTRICTION_BATCH_LIMIT) return null;
  for (const [index, row] of value.rows.entries()) {
    if (!record(row) || row.rowNumber !== index + 1 || typeof row.input !== 'string' || !row.input || row.input.length > 254
      || !optionalUuid(row.userId) || !optionalUuid(row.evidenceOrderId) || !optionalUuid(row.restrictionId)
      || (row.nickname !== null && typeof row.nickname !== 'string') || (row.maskedEmail !== null && typeof row.maskedEmail !== 'string')
      || !['ready', 'duplicate', 'invalid_input', 'not_found', 'ambiguous', 'not_eligible', 'already_active'].includes(String(row.status))
      || (row.duplicateOf !== null && (!integer(row.duplicateOf) || row.duplicateOf < 1 || row.duplicateOf >= row.rowNumber))
      || (row.outcome !== null && !['registered', 'skipped', 'failed'].includes(String(row.outcome)))
      || (row.outcome === 'registered' && !isUuid(row.restrictionId)) || (row.currentState !== null && !isUuid(row.restrictionId))
      || (row.status === 'duplicate' && row.duplicateOf === null) || (row.error !== null && typeof row.error !== 'string') || (row.currentState !== null && !['active', 'released', 'missing'].includes(String(row.currentState)))
      || (row.releasedAt !== null && !date(row.releasedAt)) || (row.currentState === 'released' && !date(row.releasedAt)) || (row.status === 'ready' && !isUuid(row.userId))) return null;
  }
  if (value.rows.filter(row => row.status === 'ready').length !== value.readyCount) return null;
  if (value.status === 'completed') {
    if (!date(value.completedAt) || value.canExecute || value.rows.some(row => row.outcome === null)
      || value.rows.filter(row => row.outcome === 'registered').length !== value.registeredCount
      || value.rows.filter(row => row.outcome === 'skipped').length !== value.skippedCount
      || value.rows.filter(row => row.outcome === 'failed').length !== value.failedCount
      || Number(value.registeredCount) + Number(value.skippedCount) + Number(value.failedCount) !== value.rows.length) return null;
  } else if (value.completedAt !== null || value.registeredCount !== 0 || value.skippedCount !== 0 || value.failedCount !== 0 || value.rows.some(row => row.outcome !== null)) return null;
  return value as unknown as PurchaseRestrictionBatch;
}
export function purchaseRestrictionBatchStatus(status: string | null): string {
  const labels: Record<string, string> = { ready: '등록 가능', duplicate: '중복 입력', invalid_input: '입력 형식 확인', not_found: '조회되지 않음', ambiguous: '회원 ID로 다시 확인', not_eligible: '운영 계정 · 등록 불가', already_active: '이미 구매제한 중', evidence_owner_mismatch: '근거 주문의 고객 불일치', request_already_released: '이미 해제된 요청' };
  return labels[status ?? ''] ?? '최신 상태 확인 필요';
}
export function purchaseRestrictionBatchError(code: string): string {
  if (code.includes('expired')) return '대상 확인 후 15분이 지났습니다. 입력 내용을 다시 확인해주세요.';
  if (code.includes('actor_mismatch')) return '대상을 확인한 운영자만 이 요청을 등록할 수 있습니다.';
  if (code.includes('request_conflict')) return '확인한 요청과 입력이 다릅니다. 새로 대상 확인을 진행해주세요.';
  if (code.includes('no_ready_targets')) return '등록 가능한 고객이 없습니다. 확인 결과를 검토해주세요.';
  if (code.includes('not_found')) return '등록 요청을 찾을 수 없습니다. 대상 확인을 다시 진행해주세요.';
  if (code.includes('confirmation_required')) return '등록 대상과 신규 주문 제한 범위를 확인해주세요.';
  return '구매제한 등록을 처리하지 못했습니다. 등록 결과를 확인해주세요.';
}
export function purchaseRestrictionBatchHref(href: string, id: string): string {
  const [path, query = ''] = href.split('?'); const params = new URLSearchParams(query); params.set('batch', id); return `${path}?${params}`;
}
