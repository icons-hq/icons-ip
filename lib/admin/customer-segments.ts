import { isUuid } from '@/lib/uuid';
export const CUSTOMER_SEGMENTS_PATH = '/admin/marketing/segments';
export const SEGMENT_GROUPS = ['potential', 'visitor', 'interested', 'buyer', 'loyal'] as const;
export type SegmentGroup = typeof SEGMENT_GROUPS[number];
export const SEGMENT_GROUP_LABELS: Record<SegmentGroup, string> = { potential: '잠재 고객', visitor: '방문 고객', interested: '관심 고객', buyer: '구매 고객', loyal: '충성 고객' };
export const SEGMENT_TARGETS = ['first_purchase', 'cart_unpurchased', 'wishlist_unpurchased', 'unused_coupon', 'ip_notifications', 'purchased', 'first_purchase_recent', 'lapsed_purchase', 'repeat_purchase', 'visited', 'not_visited', 'product_viewed', 'video_viewed', 'similar_product_viewed'] as const;
export const ACTIVITY_SEGMENT_TARGETS: readonly string[] = ['visited', 'not_visited', 'product_viewed', 'video_viewed', 'similar_product_viewed'];
export type SegmentTarget = typeof SEGMENT_TARGETS[number];
export const SEGMENT_TARGET_LABELS: Record<SegmentTarget, string> = { first_purchase: '가입 회원 중 첫구매 대상', cart_unpurchased: '장바구니 미구매', wishlist_unpurchased: '찜 미구매', unused_coupon: '미사용 쿠폰 보유', ip_notifications: 'IP 알림 구독', purchased: '구매 이력 있음', first_purchase_recent: '최근 첫구매', lapsed_purchase: '마지막 구매 후 기간 경과', repeat_purchase: '재구매', visited: '스토어 방문', not_visited: '기간 내 미방문', product_viewed: '상품 조회', video_viewed: '상품 영상 시청', similar_product_viewed: '같은 분류의 다른 상품 조회' };
export const SEGMENT_PURPOSES: Record<SegmentTarget, string> = { first_purchase: '첫구매 유도', cart_unpurchased: '구매 전환', wishlist_unpurchased: '구매 전환', unused_coupon: '쿠폰 사용 유도', ip_notifications: '관심 IP 소식 제공', purchased: '구매 고객 유지', first_purchase_recent: '다음 구매 유도', lapsed_purchase: '다시 구매 유도', repeat_purchase: '충성 고객 유지', visited: '방문을 구매로 연결', not_visited: '스토어 재방문 유도', product_viewed: '관심 상품 구매 유도', video_viewed: '영상 관심을 구매로 연결', similar_product_viewed: '비슷한 상품 소개' };
export const SEGMENT_GRADE_LABELS = { welcome: '웰컴', silver: '실버', gold: '골드', platinum: '플래티넘' } as const;
export type SegmentGrade = keyof typeof SEGMENT_GRADE_LABELS;
export interface SegmentRule { version: 1; target: SegmentTarget; goodsScope: 'all' | 'goods' | 'category'; goodIds: string[]; categoryId: string | null; months: 1 | 3 | 6 | null; activityDays: 7 | 30 | 90 | null; grades: SegmentGrade[]; ageBands: number[]; ipId: string | null; couponCode: string | null }
export interface SegmentEstimate { id: string; ruleVersion: 1; ruleHash: string; evaluatedAt: string; matchedCount: number; consentedCount: number; validUntil: string }
export interface CustomerSegment { id: string; reference: number; name: string; presetKey: string | null; ruleVersion: 1; rule: SegmentRule; ruleHash: string; target: SegmentTarget; group: SegmentGroup; revision: number; available: boolean; favorite: boolean; estimate: SegmentEstimate | null; createdAt: string; updatedAt: string }
export interface SegmentObservation { month: string; evaluatedAt: string | null; matchedCount: number | null; consentedCount: number | null }
export type SegmentOptionKind = 'good' | 'category' | 'ip' | 'coupon';
export interface SegmentOption { kind: SegmentOptionKind; id: string; label: string; extra?: string }
export interface SegmentOptions { rows: SegmentOption[]; total: number; page: number; pageSize: 20 }
export interface SegmentDetail { segment: CustomerSegment; history: SegmentObservation[]; selectedOptions: SegmentOption[] }
export interface SegmentOverview { checkedAt: string; groups: Record<SegmentGroup, number | null>; firstPurchaseMembers: number; memberCount: number }
export interface SegmentFilters { query: string; group: SegmentGroup | 'all'; target: SegmentTarget | 'all'; kind: 'all' | 'preset' | 'custom'; favoriteOnly: boolean; page: number; pageSize: 20 | 50 | 100 }
export interface SegmentList { rows: CustomerSegment[]; favorites: CustomerSegment[]; total: number; filters: SegmentFilters }
export type SegmentActionResult<T> = { data: T; error?: never; uncertain?: never } | { error: string; uncertain?: boolean; data?: never };
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isInstant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const slug = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(v);
export function isSegmentTarget(v: unknown): v is SegmentTarget { return SEGMENT_TARGETS.includes(v as SegmentTarget); }
export function segmentGroup(target: SegmentTarget): SegmentGroup { return ['not_visited', 'similar_product_viewed'].includes(target) ? 'potential' : ['first_purchase', 'visited'].includes(target) ? 'visitor' : ['cart_unpurchased', 'wishlist_unpurchased', 'unused_coupon', 'ip_notifications', 'product_viewed', 'video_viewed'].includes(target) ? 'interested' : target === 'repeat_purchase' ? 'loyal' : 'buyer'; }
export function defaultSegmentRule(target: SegmentTarget = 'first_purchase'): SegmentRule {
  return { version: 1, target, goodsScope: target === 'similar_product_viewed' ? 'goods' : 'all', goodIds: [], categoryId: null, months: target === 'first_purchase_recent' ? 1 : target === 'lapsed_purchase' ? 3 : null, activityDays: ACTIVITY_SEGMENT_TARGETS.includes(target) ? 30 : null, grades: [], ageBands: [], ipId: null, couponCode: null };
}
export function normalizeSegmentRule(v: unknown): SegmentRule | null {
  if (!isRecord(v) || v.version !== 1 || !isSegmentTarget(v.target) || Object.keys(v).some(k => !['version','target','goodsScope','goodIds','categoryId','months','activityDays','grades','ageBands','ipId','couponCode'].includes(k))) return null;
  const rule = { ...defaultSegmentRule(v.target), months: null, ...v };
  if (ACTIVITY_SEGMENT_TARGETS.includes(rule.target) && rule.activityDays === null) rule.activityDays = 30;
  if (!['all','goods','category'].includes(String(rule.goodsScope)) || !Array.isArray(rule.goodIds) || rule.goodIds.length > 100 || rule.goodIds.some(x => !slug(x)) || new Set(rule.goodIds).size !== rule.goodIds.length
    || !Array.isArray(rule.grades) || rule.grades.some(x => typeof x !== 'string' || !Object.hasOwn(SEGMENT_GRADE_LABELS, x)) || new Set(rule.grades).size !== rule.grades.length
    || !Array.isArray(rule.ageBands) || rule.ageBands.some(x => ![10,20,30,40,50,60].includes(Number(x)) || typeof x !== 'number') || new Set(rule.ageBands).size !== rule.ageBands.length
    || (rule.categoryId !== null && !isUuid(rule.categoryId)) || (rule.ipId !== null && (!slug(rule.ipId) || rule.target !== 'ip_notifications'))
    || (rule.couponCode !== null && (typeof rule.couponCode !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(rule.couponCode) || rule.target !== 'unused_coupon'))) return null;
  if ((rule.goodsScope === 'all' && (rule.goodIds.length > 0 || rule.categoryId !== null)) || (rule.goodsScope === 'goods' && (!rule.goodIds.length || rule.categoryId !== null))
    || (rule.goodsScope === 'category' && (!rule.categoryId || rule.goodIds.length > 0)) || (!['cart_unpurchased','wishlist_unpurchased','purchased','product_viewed','video_viewed','similar_product_viewed'].includes(rule.target) && rule.goodsScope !== 'all')
    || (rule.target === 'similar_product_viewed' && rule.goodsScope !== 'goods')) return null;
  if ((rule.months !== null && ![1,3,6].includes(Number(rule.months))) || (rule.target === 'first_purchase_recent' && rule.months === null)
    || (rule.target === 'lapsed_purchase' && ![3,6].includes(Number(rule.months))) || (rule.target === 'repeat_purchase' && rule.months !== null && ![1,3].includes(Number(rule.months)))
    || (!['first_purchase_recent','lapsed_purchase','repeat_purchase','purchased'].includes(rule.target) && rule.months !== null)
    || (rule.activityDays !== null && (![7,30,90].includes(Number(rule.activityDays)) || !['cart_unpurchased','wishlist_unpurchased',...ACTIVITY_SEGMENT_TARGETS].includes(rule.target)))
    || (ACTIVITY_SEGMENT_TARGETS.includes(rule.target) && rule.activityDays === null)) return null;
  if ((rule.months !== null && typeof rule.months !== 'number') || (rule.activityDays !== null && typeof rule.activityDays !== 'number')) return null;
  return { ...rule, goodIds: [...rule.goodIds].sort(), grades: [...rule.grades].sort(), ageBands: [...rule.ageBands].sort((a,b) => a-b), categoryId: rule.categoryId?.toLowerCase() ?? null } as SegmentRule;
}
export function segmentRuleKey(rule: SegmentRule) { return JSON.stringify(normalizeSegmentRule(rule)); }
export function parseSegmentEstimate(v: unknown): SegmentEstimate | null {
  if (!isRecord(v) || !isUuid(v.id) || v.ruleVersion !== 1 || typeof v.ruleHash !== 'string' || !/^[0-9a-f]{64}$/.test(v.ruleHash) || !isInstant(v.evaluatedAt) || !isInstant(v.validUntil)
    || !isCount(v.matchedCount) || !isCount(v.consentedCount) || v.consentedCount > v.matchedCount || Date.parse(v.validUntil) <= Date.parse(v.evaluatedAt)) return null;
  return v as unknown as SegmentEstimate;
}
export function parseCustomerSegment(v: unknown): CustomerSegment | null {
  if (!isRecord(v)) return null; const rule = normalizeSegmentRule(v.rule), estimate = v.estimate === null ? null : parseSegmentEstimate(v.estimate);
  if (!rule || !isUuid(v.id) || !isCount(v.reference) || v.reference < 1 || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 50 || (v.presetKey !== null && !isSegmentTarget(v.presetKey))
    || v.ruleVersion !== 1 || v.target !== rule.target || v.group !== segmentGroup(rule.target) || typeof v.ruleHash !== 'string' || !/^[0-9a-f]{64}$/.test(v.ruleHash)
    || !isCount(v.revision) || v.revision < 1 || typeof v.available !== 'boolean' || typeof v.favorite !== 'boolean' || !isInstant(v.createdAt) || !isInstant(v.updatedAt)
    || (v.estimate !== null && (!estimate || estimate.ruleHash !== v.ruleHash))) return null;
  return { ...v, rule, estimate } as unknown as CustomerSegment;
}
export function parseSegmentOptions(v: unknown): SegmentOption[] | null {
  if (!Array.isArray(v) || v.length > 103) return null; const seen = new Set<string>();
  for (const row of v) { if (!isRecord(row) || !['good','category','ip','coupon'].includes(String(row.kind)) || typeof row.id !== 'string' || typeof row.label !== 'string'
      || (row.extra !== undefined && typeof row.extra !== 'string') || seen.has(`${row.kind}:${row.id}`)
      || (row.kind === 'category' ? !isUuid(row.id) : row.kind === 'coupon' ? !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(row.id) : !slug(row.id))) return null; seen.add(`${row.kind}:${row.id}`); }
  return v as SegmentOption[];
}
export function normalizeSegmentFilters(params: Record<string,string|string[]|undefined>): SegmentFilters {
  const first = (v: string|string[]|undefined) => Array.isArray(v) ? v[0] : v;
  const group = first(params.group), target = first(params.target), kind = first(params.kind), page = Number(first(params.page)), size = Number(first(params.pageSize));
  return { query: (first(params.q) ?? '').trim().slice(0,100), group: SEGMENT_GROUPS.includes(group as SegmentGroup) ? group as SegmentGroup : 'all', target: isSegmentTarget(target) ? target : 'all',
    kind: kind === 'preset' || kind === 'custom' ? kind : 'all', favoriteOnly: first(params.favorite) === '1', page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1, pageSize: size === 50 || size === 100 ? size : 20 };
}
export function customerSegmentsHref(filters: SegmentFilters, page = filters.page) {
  const p = new URLSearchParams({ group: filters.group, target: filters.target, kind: filters.kind, page: String(page), pageSize: String(filters.pageSize) }); if (filters.query) p.set('q',filters.query); if (filters.favoriteOnly) p.set('favorite','1'); return `${CUSTOMER_SEGMENTS_PATH}?${p}`;
}
export function segmentRuleSummary(rule: SegmentRule, options: SegmentOption[] = []): string[] {
  const label = (kind: SegmentOptionKind, id: string) => options.find(option => option.kind === kind && option.id === id)?.label ?? id;
  return [SEGMENT_TARGET_LABELS[rule.target], rule.goodsScope === 'goods' ? `선택 상품 ${rule.goodIds.length}개` : rule.goodsScope === 'category' ? `분류: ${label('category',rule.categoryId ?? '')} 및 하위 분류` : '전체 상품',
    ...(rule.months ? [rule.target === 'lapsed_purchase' ? `마지막 구매 후 ${rule.months}개월 경과` : `최근 ${rule.months}개월`] : []), ...(rule.activityDays ? [`최근 ${rule.activityDays}일${ACTIVITY_SEGMENT_TARGETS.includes(rule.target) ? ' 이용 관측' : ' 등록'}`] : []),
    ...(rule.ipId ? [`IP: ${label('ip',rule.ipId)}`] : []), ...(rule.couponCode ? [`쿠폰: ${label('coupon',rule.couponCode)}`] : []),
    rule.grades.length ? rule.grades.map(g => SEGMENT_GRADE_LABELS[g]).join('·') : '전체 회원 등급', rule.ageBands.length ? rule.ageBands.map(b => b === 60 ? '60세 이상' : `${b}대`).join('·') : '전체 연령대'];
}
export function segmentMonthComparison(history: SegmentObservation[]): string {
  const previous = history.at(-2)?.matchedCount, current = history.at(-1)?.matchedCount;
  if (previous === null || previous === undefined || current === null || current === undefined) return '전월 대비 미집계';
  const difference = current - previous;
  if (previous === 0) return current === 0 ? '전월 대비 변동 없음 (0명)' : `전월 0명 → 이번 달 ${current.toLocaleString('ko-KR')}명`;
  const percent = Math.round(difference / previous * 1000) / 10;
  return `전월 대비 ${difference > 0 ? '+' : ''}${difference.toLocaleString('ko-KR')}명 (${percent > 0 ? '+' : ''}${percent}%)`;
}
