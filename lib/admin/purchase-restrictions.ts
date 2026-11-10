import { adminGoodsCopy } from '@/lib/admin/vocabulary';
export const PURCHASE_RESTRICTION_REASONS = [
  { value: 'repeated_purchase', label: '구매의사 없는 반복구매' },
  { value: 'verbal_abuse', label: '언어폭력' },
  { value: 'business_interference', label: '영업방해' },
  { value: 'other', label: '기타' },
] as const;
export type PurchaseRestrictionReason = typeof PURCHASE_RESTRICTION_REASONS[number]['value'];
export interface PurchaseRestrictionCustomer {
  id: string; nickname: string | null; email: string | null; eligible: boolean; activeRestrictionId: string | null;
}
export interface PurchaseRestrictionRow {
  id: string; userId: string; nickname: string | null; maskedEmail: string;
  reasonCode: PurchaseRestrictionReason; reasonDetail: string; evidenceOrderId: string | null;
  createdAt: string; createdBy: string | null; releasedAt: string | null; releasedBy: string | null; releaseReason: string | null;
}
export interface PurchaseRestrictionFilters { query: string; state: 'all' | 'active' | 'released'; page: number; pageSize: 20 | 50 | 100 }
export interface PurchaseRestrictionData { filters: PurchaseRestrictionFilters; rows: PurchaseRestrictionRow[]; total: number }
// PostgreSQL also accepts the deterministic UUIDs used for batch child requests.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const string = (value: FormDataEntryValue | null) => typeof value === 'string' ? value.trim() : '';
export function normalizePurchaseRestrictionFilters(input: Record<string, string | string[] | undefined>): PurchaseRestrictionFilters {
  const first = (name: string) => Array.isArray(input[name]) ? input[name][0] : input[name];
  const size = Number(first('pageSize'));
  const pageSize = size === 50 || size === 100 ? size : 20;
  const page = Number(first('page'));
  const state = first('state');
  return { query: (first('query') ?? '').trim().slice(0, 254), state: state === 'all' || state === 'released' ? state : 'active', pageSize,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, Math.floor(100000 / pageSize) + 1) : 1 };
}
export function purchaseRestrictionsHref(filters: PurchaseRestrictionFilters) {
  const params = new URLSearchParams({ state: filters.state });
  if (filters.query) params.set('query', filters.query);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.pageSize !== 20) params.set('pageSize', String(filters.pageSize));
  return `/admin/sales/purchase-restrictions?${params}`;
}
export function normalizePurchaseRestrictionRegistration(form: FormData) {
  const value = { requestId: string(form.get('requestId')), userId: string(form.get('userId')), reasonCode: string(form.get('reasonCode')),
    reasonDetail: string(form.get('reasonDetail')), evidenceOrderId: string(form.get('evidenceOrderId')) || null };
  if (!UUID.test(value.requestId) || !UUID.test(value.userId)) return { error: '고객을 다시 조회한 뒤 등록해주세요.' } as const;
  if (!PURCHASE_RESTRICTION_REASONS.some(({ value: reason }) => reason === value.reasonCode)) return { error: '등록 사유를 선택해주세요.' } as const;
  if (!value.reasonDetail || value.reasonDetail.length > 200) return { error: '상세 사유를 1~200자로 입력해주세요.' } as const;
  if (value.evidenceOrderId && !UUID.test(value.evidenceOrderId)) return { error: '근거 주문번호를 확인해주세요.' } as const;
  if (form.get('confirmed') !== 'on') return { error: adminGoodsCopy('신규 굿즈 주문 제한 범위를 확인해주세요.') } as const;
  return { value } as const;
}
export function normalizePurchaseRestrictionRelease(form: FormData) {
  const value = { restrictionId: string(form.get('restrictionId')), reason: string(form.get('reason')) };
  if (!UUID.test(value.restrictionId)) return { error: '구매제한 기록을 다시 조회해주세요.' } as const;
  if (!value.reason || value.reason.length > 200) return { error: '해제 사유를 1~200자로 입력해주세요.' } as const;
  return { value } as const;
}
export function purchaseRestrictionError(message: string) {
  if (message.includes('evidence_owner_mismatch')) return '해당 고객의 주문번호만 근거로 등록할 수 있습니다.';
  if (message.includes('already_active')) return '이미 구매제한 중인 고객입니다. 목록을 새로 확인해주세요.';
  if (message.includes('customer_not_eligible')) return '일반 고객 계정만 구매제한을 등록할 수 있습니다.';
  if (message.includes('request_conflict')) return '같은 요청의 내용이 바뀌었습니다. 고객을 다시 조회해주세요.';
  if (message.includes('not_found')) return '해당 구매제한 기록을 찾을 수 없습니다.';
  if (message.includes('forbidden') || message.includes('auth_required')) return '관리자 권한을 확인해주세요.';
  return '구매제한을 처리하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 시도해주세요.';
}
