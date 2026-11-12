import { isUuid } from '@/lib/uuid';
import { transactionExactKeys as exact, transactionInstant as instant, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { goodsBulkSkipLabel } from './goods-bulk';
import { validGoodsGroupGoodId } from './goods-groups';

/*
 * 할인 프로모션 묶음(1014-109·110·X37). 이름·기간·대상(기획전 상품·IP·선택 상품)·일괄 할인·상품별 예외를 한 번에 걸고,
 * 결과는 기존 옵션 기간할인 원장에 출처와 함께 쓴다(가격 계산 순서는 그대로, 한 상품 한 시점 할인가 하나).
 * 판정의 진실원은 DB(admin_preview/commit/stop_discount_promotion)다. 여기 있는 것은 화면 입력 정규화와 응답 모양 검사뿐이다.
 */

export const DISCOUNT_PROMOTIONS_PATH = '/admin/sales/discount-promotions';
/** 한 프로모션의 대상 상품 상한. IP 전체 즉시할인과 같은 1,000개다. */
export const DISCOUNT_PROMOTION_GOODS_LIMIT = 1000;
export const DISCOUNT_PROMOTION_NAME_MAX = 60;
export const DISCOUNT_PROMOTION_LIST_PAGE_SIZE = 50;

export type DiscountPromotionTargetKind = 'campaign' | 'ip' | 'goods';
export type DiscountPromotionRuleMode = 'rate' | 'amount';
export type DiscountPromotionExceptionMode = 'rate' | 'amount' | 'price' | 'exclude';
export interface DiscountPromotionRule { mode: DiscountPromotionRuleMode; value: number }
export type DiscountPromotionException = { goodId: string; mode: 'exclude' } | { goodId: string; mode: 'rate' | 'amount' | 'price'; value: number };
export interface DiscountPromotionTarget { kind: DiscountPromotionTargetKind; ids: string[] }
export interface DiscountPromotionRequest {
  name: string; startsAt: string; endsAt: string; target: DiscountPromotionTarget; rule: DiscountPromotionRule; exceptions: DiscountPromotionException[];
}
/** 그 상품에 실제로 적용한 규칙. `source`가 exception이면 상품별 예외다. */
export interface DiscountPromotionAppliedRule { source: 'default' | 'exception'; mode: DiscountPromotionExceptionMode; value: number | null }
export interface DiscountPromotionOverlap { promotionId: string | null; promotionName: string | null; startsAt: string; endsAt: string }
export interface DiscountPromotionPreviewGood {
  id: string; name: string; code: string | null; price: number; priceMin: number | null; priceMax: number | null; nextMin: number | null; nextMax: number | null;
  published: boolean; archived: boolean; rule: DiscountPromotionAppliedRule; skip: string | null; overlap: DiscountPromotionOverlap | null;
}
export interface DiscountPromotionPreview {
  state: 'ready'; operationId: string; request: DiscountPromotionRequest;
  target: { kind: DiscountPromotionTargetKind; ids: string[]; label: string | null }; goods: DiscountPromotionPreviewGood[]; expiresAt: string;
}
export interface DiscountPromotionSkipped { id: string; name: string; code: string | null; reason: string }
export interface DiscountPromotionReceipt {
  state: 'completed' | 'rejected' | 'unresolved' | 'sealed'; operationId: string; promotionId: string | null;
  goodsCount: number; periodCount: number; skipped: DiscountPromotionSkipped[]; error: string | null;
}
export interface DiscountPromotionDiscountCounts { active: number; ended: number; disabled: number }
export interface DiscountPromotionSummary {
  id: string; name: string; state: 'active' | 'stopped'; startsAt: string; endsAt: string;
  target: { kind: DiscountPromotionTargetKind; id: string | null; label: string | null };
  rule: DiscountPromotionRule; goodsCount: number; appliedCount: number; exceptionCount: number; discounts: DiscountPromotionDiscountCounts;
  revision: number; createdAt: string; createdByName: string | null; stoppedAt: string | null; stoppedByName: string | null;
}
export interface DiscountPromotionList { checkedAt: string; total: number; rows: DiscountPromotionSummary[] }
export interface DiscountPromotionDetailGood {
  id: string; name: string; code: string | null; archived: boolean; rule: DiscountPromotionAppliedRule; skip: string | null;
  priceMin: number | null; priceMax: number | null; discounts: DiscountPromotionDiscountCounts & { minPrice: number | null; maxPrice: number | null };
}
export interface DiscountPromotionStopReceipt { state: 'completed'; operationId: string; promotionId: string; disabledCount: number; goodsCount: number; stoppedAt: string }
export interface DiscountPromotionDetail extends DiscountPromotionSummary { checkedAt: string; stopReceipt: DiscountPromotionStopReceipt | null; goods: DiscountPromotionDetailGood[] }
export interface DiscountPromotionTargetOptions {
  campaigns: { id: string; title: string; status: string; startsAt: string; endsAt: string; goodsCount: number }[];
  ips: { id: string; title: string; goodsCount: number }[];
}

export const DISCOUNT_PROMOTION_TARGET_LABELS: Record<DiscountPromotionTargetKind, string> = {
  campaign: '기획전(캠페인) 상품', ip: 'IP 전체 상품', goods: '선택 상품',
};
/** 화면의 상태 이름. 등록 상태(active)는 기간과 조회 시각으로 예정·진행·종료로 나눈다. */
export type DiscountPromotionPhase = 'scheduled' | 'running' | 'ended' | 'stopped';
export const DISCOUNT_PROMOTION_PHASE_LABELS: Record<DiscountPromotionPhase, string> = {
  scheduled: '예정', running: '진행 중', ended: '종료', stopped: '중지',
};
export function discountPromotionPhase(promotion: Pick<DiscountPromotionSummary, 'state' | 'startsAt' | 'endsAt'>, now: string | number | Date): DiscountPromotionPhase {
  if (promotion.state === 'stopped') return 'stopped';
  const at = new Date(now).getTime();
  if (at < Date.parse(promotion.startsAt)) return 'scheduled';
  return at < Date.parse(promotion.endsAt) ? 'running' : 'ended';
}

/**
 * 규칙을 바꿔도 결과가 같은 건너뜀(기간이 겹치는 할인·판매 중인 옵션 없음·보관). 비교 표에서 그 줄의 규칙 선택을 잠근다.
 * 할인 제외(운영자가 고른 예외)와 할인가 범위 밖은 규칙을 바꾸면 달라지므로 열어 둔다.
 */
const RULE_LOCKED_SKIPS = new Set(['price_period_overlap', 'price_period_variant_inactive', 'good_archived']);
export function discountPromotionRuleLocked(skip: string | null | undefined) { return Boolean(skip) && RULE_LOCKED_SKIPS.has(skip!); }

const SKIP_LABELS: Record<string, string> = {
  discount_promotion_excluded: '예외로 할인에서 제외',
  good_archived: '보관된 상품',
};
/** 건너뛴 이유. 일괄 즉시할인과 같은 판정(겹침·판매 옵션 없음·할인가 범위)은 같은 문구를 쓴다. */
export function discountPromotionSkipLabel(reason: string) { return SKIP_LABELS[reason] ?? goodsBulkSkipLabel(reason); }

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
/** 규칙 한 줄 요약: "10% 할인", "1,000원 할인", "예외가 7,000원", "할인 제외". */
export function discountRuleLabel(rule: { mode: DiscountPromotionExceptionMode; value: number | null }) {
  if (rule.mode === 'exclude') return '할인 제외';
  if (rule.value === null) return '규칙 확인 필요';
  if (rule.mode === 'rate') return `${rule.value}% 할인`;
  if (rule.mode === 'amount') return `${won(rule.value)} 할인`;
  return `예외가 ${won(rule.value)}`;
}

export function discountPromotionHref(id: string) { return `${DISCOUNT_PROMOTIONS_PATH}/${encodeURIComponent(id)}`; }
/** 새 프로모션 주소. `from: 'campaign'`은 캠페인 편집에서 연 경우다 — 그 화면의 취소·돌아가기가 캠페인 편집으로 간다(QA1 MD). */
export function newDiscountPromotionHref(prefill: { campaign?: string; ip?: string; from?: 'campaign' } = {}) {
  const params = new URLSearchParams();
  if (prefill.campaign) params.set('campaign', prefill.campaign);
  else if (prefill.ip) params.set('ip', prefill.ip);
  if (prefill.campaign && prefill.from === 'campaign') params.set('from', 'campaign');
  const query = params.toString();
  return `${DISCOUNT_PROMOTIONS_PATH}/new${query ? `?${query}` : ''}`;
}
export function discountPromotionListHref(filters: { campaign?: string | null; page?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.campaign) params.set('campaign', filters.campaign);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return `${DISCOUNT_PROMOTIONS_PATH}${query ? `?${query}` : ''}`;
}

const CAMPAIGN_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
export function validCampaignId(value: unknown): value is string { return typeof value === 'string' && CAMPAIGN_ID.test(value); }
export function validIpId(value: unknown): value is string { return typeof value === 'string' && IP_ID.test(value); }
function targetId(kind: DiscountPromotionTargetKind, value: unknown): value is string {
  return kind === 'campaign' ? validCampaignId(value) : kind === 'ip' ? validIpId(value) : validGoodsGroupGoodId(value);
}
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && [...value].length <= max; }
const money = (value: unknown): value is number => integer(value, 0, 2_147_483_647);
const positive = (value: unknown): value is number => integer(value, 1, 2_147_483_647);
const code = /^[a-z][a-z0-9_]{0,100}$/;

export function parseDiscountPromotionRule(value: unknown): DiscountPromotionRule | null {
  if (!record(value) || !exact(value, ['mode', 'value']) || (value.mode !== 'rate' && value.mode !== 'amount') || !positive(value.value)
    || value.mode === 'rate' && value.value >= 100) return null;
  return { mode: value.mode, value: value.value };
}
function parseException(value: unknown): DiscountPromotionException | null {
  if (!record(value) || !validGoodsGroupGoodId(value.goodId)) return null;
  if (value.mode === 'exclude') return exact(value, ['goodId', 'mode']) ? { goodId: value.goodId, mode: 'exclude' } : null;
  if (!exact(value, ['goodId', 'mode', 'value']) || !['rate', 'amount', 'price'].includes(String(value.mode)) || !positive(value.value)
    || value.mode === 'rate' && value.value >= 100) return null;
  return { goodId: value.goodId, mode: value.mode as 'rate' | 'amount' | 'price', value: value.value };
}

/** 서버로 보내기 전 요청 모양 검사. DB의 private.discount_promotion_validate와 같은 규칙이다. */
export function parseDiscountPromotionRequest(value: unknown): DiscountPromotionRequest | null {
  if (!record(value) || !exact(value, ['name', 'startsAt', 'endsAt', 'target', 'rule', 'exceptions'])) return null;
  const name = value.name;
  if (typeof name !== 'string' || name !== name.trim() || !boundedText(name, DISCOUNT_PROMOTION_NAME_MAX) || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (!instant(value.startsAt) || !instant(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt)) return null;
  const target = value.target;
  if (!record(target) || !exact(target, ['kind', 'ids']) || !['campaign', 'ip', 'goods'].includes(String(target.kind)) || !Array.isArray(target.ids)) return null;
  const kind = target.kind as DiscountPromotionTargetKind;
  if (kind === 'goods' ? target.ids.length < 1 || target.ids.length > DISCOUNT_PROMOTION_GOODS_LIMIT : target.ids.length !== 1) return null;
  if (target.ids.some(id => !targetId(kind, id)) || new Set(target.ids).size !== target.ids.length) return null;
  const rule = parseDiscountPromotionRule(value.rule);
  if (!rule || !Array.isArray(value.exceptions) || value.exceptions.length > DISCOUNT_PROMOTION_GOODS_LIMIT) return null;
  const exceptions: DiscountPromotionException[] = [];
  for (const item of value.exceptions) {
    const parsed = parseException(item);
    if (!parsed) return null;
    exceptions.push(parsed);
  }
  if (new Set(exceptions.map(item => item.goodId)).size !== exceptions.length) return null;
  return { name, startsAt: value.startsAt, endsAt: value.endsAt, target: { kind, ids: [...target.ids] as string[] }, rule, exceptions };
}

function parseAppliedRule(value: unknown): DiscountPromotionAppliedRule | null {
  if (!record(value) || !exact(value, ['source', 'mode', 'value']) || (value.source !== 'default' && value.source !== 'exception')) return null;
  if (value.mode === 'exclude') return value.source === 'exception' && value.value === null ? { source: 'exception', mode: 'exclude', value: null } : null;
  if (!['rate', 'amount', 'price'].includes(String(value.mode)) || !positive(value.value) || value.mode === 'rate' && value.value >= 100
    || value.source === 'default' && value.mode === 'price') return null;
  return { source: value.source, mode: value.mode as DiscountPromotionExceptionMode, value: value.value };
}
function priceRange(row: Record<string, unknown>, min: string, max: string) {
  if (row[min] === null && row[max] === null) return true;
  return money(row[min]) && money(row[max]) && Number(row[min]) <= Number(row[max]);
}
function parseOverlap(value: unknown): DiscountPromotionOverlap | null | false {
  if (value === null || value === undefined) return null;
  if (!record(value) || !exact(value, ['promotionId', 'promotionName', 'startsAt', 'endsAt']) || !instant(value.startsAt) || !instant(value.endsAt)) return false;
  if (value.promotionId === null) return value.promotionName === null ? { promotionId: null, promotionName: null, startsAt: value.startsAt, endsAt: value.endsAt } : false;
  if (!isUuid(value.promotionId) || !boundedText(value.promotionName, DISCOUNT_PROMOTION_NAME_MAX)) return false;
  return { promotionId: value.promotionId, promotionName: value.promotionName, startsAt: value.startsAt, endsAt: value.endsAt };
}

export function parseDiscountPromotionPreview(value: unknown, expectedId: string, request: DiscountPromotionRequest): DiscountPromotionPreview | null {
  if (!record(value) || !exact(value, ['state', 'operationId', 'request', 'target', 'goods', 'expiresAt']) || value.state !== 'ready'
    || !isUuid(expectedId) || value.operationId !== expectedId || !instant(value.expiresAt) || !Array.isArray(value.goods)
    || value.goods.length < 1 || value.goods.length > DISCOUNT_PROMOTION_GOODS_LIMIT) return null;
  const received = parseDiscountPromotionRequest(value.request);
  if (!received || JSON.stringify(received) !== JSON.stringify(request)) return null;
  const target = value.target;
  if (!record(target) || !exact(target, ['kind', 'ids', 'label']) || target.kind !== request.target.kind
    || JSON.stringify(target.ids) !== JSON.stringify(request.target.ids) || !(target.label === null || boundedText(target.label, 200))
    || (request.target.kind === 'goods') !== (target.label === null)) return null;
  const goods: DiscountPromotionPreviewGood[] = [];
  const seen = new Set<string>();
  for (const row of value.goods) {
    if (!record(row) || !exact(row, ['id', 'name', 'code', 'price', 'priceMin', 'priceMax', 'nextMin', 'nextMax', 'published', 'archived', 'rule', 'skip', 'overlap'])
      || !validGoodsGroupGoodId(row.id) || seen.has(row.id) || !boundedText(row.name, 200) || !(row.code === null || boundedText(row.code, 120))
      || !money(row.price) || !priceRange(row, 'priceMin', 'priceMax') || !priceRange(row, 'nextMin', 'nextMax')
      || typeof row.published !== 'boolean' || typeof row.archived !== 'boolean'
      || !(row.skip === null || typeof row.skip === 'string' && code.test(row.skip))) return null;
    const rule = parseAppliedRule(row.rule);
    const overlap = parseOverlap(row.overlap);
    if (!rule || overlap === false || (overlap !== null) !== (row.skip === 'price_period_overlap')
      || (row.skip === null) === (row.nextMin === null)) return null;
    seen.add(row.id);
    goods.push({ id: row.id, name: row.name, code: row.code as string | null, price: row.price, priceMin: row.priceMin as number | null, priceMax: row.priceMax as number | null,
      nextMin: row.nextMin as number | null, nextMax: row.nextMax as number | null, published: row.published, archived: row.archived, rule, skip: row.skip as string | null, overlap });
  }
  if (request.target.kind === 'goods' && (goods.length !== request.target.ids.length || goods.some(row => !request.target.ids.includes(row.id)))) return null;
  if (goods.every(row => row.skip)) return null;
  return { state: 'ready', operationId: expectedId, request: received, target: { kind: received.target.kind, ids: received.target.ids, label: target.label as string | null }, goods, expiresAt: value.expiresAt };
}

function parseSkipped(value: unknown): DiscountPromotionSkipped[] | null {
  if (!Array.isArray(value) || value.length > DISCOUNT_PROMOTION_GOODS_LIMIT) return null;
  const rows: DiscountPromotionSkipped[] = [];
  for (const row of value) {
    if (!record(row) || !exact(row, ['id', 'name', 'code', 'reason']) || !validGoodsGroupGoodId(row.id) || !boundedText(row.name, 200)
      || !(row.code === null || boundedText(row.code, 120)) || typeof row.reason !== 'string' || !code.test(row.reason)) return null;
    rows.push({ id: row.id, name: row.name, code: row.code as string | null, reason: row.reason });
  }
  return rows;
}
export function parseDiscountPromotionReceipt(value: unknown, expectedId: string): DiscountPromotionReceipt | null {
  if (!record(value) || !exact(value, ['state', 'operationId', 'promotionId', 'goodsCount', 'periodCount', 'skipped', 'error'])
    || !isUuid(expectedId) || value.operationId !== expectedId || !['completed', 'rejected', 'unresolved', 'sealed'].includes(String(value.state))
    || !integer(value.goodsCount, 0, DISCOUNT_PROMOTION_GOODS_LIMIT) || !integer(value.periodCount, 0, 100_000)) return null;
  const skipped = parseSkipped(value.skipped);
  if (!skipped) return null;
  if (value.state === 'completed') {
    if (value.promotionId !== expectedId || value.goodsCount < 1 || value.periodCount < value.goodsCount || value.error !== null) return null;
  } else if (value.promotionId !== null || value.goodsCount !== 0 || value.periodCount !== 0 || skipped.length
    || (value.state === 'rejected' ? typeof value.error !== 'string' || !code.test(value.error) : value.error !== null)) return null;
  return { state: value.state as DiscountPromotionReceipt['state'], operationId: expectedId, promotionId: value.promotionId as string | null,
    goodsCount: value.goodsCount, periodCount: value.periodCount, skipped, error: value.error as string | null };
}

function parseCounts(value: unknown): DiscountPromotionDiscountCounts | null {
  if (!record(value) || !exact(value, ['active', 'ended', 'disabled']) || !integer(value.active, 0, 100_000) || !integer(value.ended, 0, 100_000)
    || !integer(value.disabled, 0, 100_000)) return null;
  return { active: value.active, ended: value.ended, disabled: value.disabled };
}
const SUMMARY_KEYS = ['id', 'name', 'state', 'startsAt', 'endsAt', 'target', 'rule', 'goodsCount', 'appliedCount', 'exceptionCount', 'discounts',
  'revision', 'createdAt', 'createdByName', 'stoppedAt', 'stoppedByName'] as const;
function parseSummaryFields(value: Record<string, unknown>): DiscountPromotionSummary | null {
  const target = value.target;
  if (!isUuid(value.id) || !boundedText(value.name, DISCOUNT_PROMOTION_NAME_MAX) || (value.state !== 'active' && value.state !== 'stopped')
    || !instant(value.startsAt) || !instant(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt)
    || !record(target) || !exact(target, ['kind', 'id', 'label']) || !['campaign', 'ip', 'goods'].includes(String(target.kind))
    || (target.kind === 'goods' ? target.id !== null : !targetId(target.kind as DiscountPromotionTargetKind, target.id))
    || !(target.label === null || boundedText(target.label, 200))
    || !integer(value.goodsCount, 1, DISCOUNT_PROMOTION_GOODS_LIMIT) || !integer(value.appliedCount, 1, value.goodsCount)
    || !integer(value.exceptionCount, 0, value.goodsCount) || !integer(value.revision, 1)
    || !instant(value.createdAt) || !(value.createdByName === null || boundedText(value.createdByName, 100))
    || !(value.stoppedAt === null || instant(value.stoppedAt)) || !(value.stoppedByName === null || boundedText(value.stoppedByName, 100))
    || (value.state === 'stopped') !== (value.stoppedAt !== null)) return null;
  const rule = parseDiscountPromotionRule(value.rule);
  const discounts = parseCounts(value.discounts);
  if (!rule || !discounts) return null;
  return { id: value.id, name: value.name, state: value.state, startsAt: value.startsAt, endsAt: value.endsAt,
    target: { kind: target.kind as DiscountPromotionTargetKind, id: target.id as string | null, label: target.label as string | null },
    rule, goodsCount: value.goodsCount, appliedCount: value.appliedCount, exceptionCount: value.exceptionCount, discounts, revision: value.revision,
    createdAt: value.createdAt, createdByName: value.createdByName as string | null, stoppedAt: value.stoppedAt as string | null, stoppedByName: value.stoppedByName as string | null };
}
export function parseDiscountPromotionList(value: unknown): DiscountPromotionList | null {
  if (!record(value) || !exact(value, ['checkedAt', 'total', 'rows']) || !instant(value.checkedAt) || !integer(value.total, 0, 1_000_000)
    || !Array.isArray(value.rows) || value.rows.length > 100) return null;
  const rows: DiscountPromotionSummary[] = [];
  for (const row of value.rows) {
    if (!record(row) || !exact(row, SUMMARY_KEYS)) return null;
    const parsed = parseSummaryFields(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return { checkedAt: value.checkedAt, total: value.total, rows };
}
export function parseDiscountPromotionStopReceipt(value: unknown, expected?: { promotionId: string; operationId: string }): DiscountPromotionStopReceipt | null {
  if (!record(value) || !exact(value, ['state', 'operationId', 'promotionId', 'disabledCount', 'goodsCount', 'stoppedAt']) || value.state !== 'completed'
    || !isUuid(value.operationId) || !isUuid(value.promotionId) || !integer(value.disabledCount, 0, 100_000)
    || !integer(value.goodsCount, 0, DISCOUNT_PROMOTION_GOODS_LIMIT) || !instant(value.stoppedAt)
    || expected && (value.promotionId !== expected.promotionId || value.operationId !== expected.operationId)) return null;
  return { state: 'completed', operationId: value.operationId, promotionId: value.promotionId, disabledCount: value.disabledCount, goodsCount: value.goodsCount, stoppedAt: value.stoppedAt };
}
export function parseDiscountPromotionDetail(value: unknown): DiscountPromotionDetail | null {
  if (!record(value) || !exact(value, [...SUMMARY_KEYS, 'checkedAt', 'stopReceipt', 'goods']) || !instant(value.checkedAt)
    || !Array.isArray(value.goods) || value.goods.length > DISCOUNT_PROMOTION_GOODS_LIMIT) return null;
  const summary = parseSummaryFields(value);
  /* 건너뛴 초안 상품이 나중에 삭제되면 그 줄만 사라진다 — 대상 수보다 많을 수는 없다. */
  if (!summary || value.goods.length > summary.goodsCount) return null;
  const stopReceipt = value.stopReceipt === null ? null : parseDiscountPromotionStopReceipt(value.stopReceipt);
  if (value.stopReceipt !== null && !stopReceipt || (summary.state === 'stopped') !== (stopReceipt !== null)) return null;
  const goods: DiscountPromotionDetailGood[] = [];
  for (const row of value.goods) {
    if (!record(row) || !exact(row, ['id', 'name', 'code', 'archived', 'rule', 'skip', 'priceMin', 'priceMax', 'discounts']) || !validGoodsGroupGoodId(row.id)
      || !boundedText(row.name, 200) || !(row.code === null || boundedText(row.code, 120)) || typeof row.archived !== 'boolean'
      || !(row.skip === null || typeof row.skip === 'string' && code.test(row.skip)) || !priceRange(row, 'priceMin', 'priceMax')) return null;
    const rule = parseAppliedRule(row.rule);
    const discounts = record(row.discounts) ? row.discounts : null;
    const counts = discounts && exact(discounts, ['active', 'ended', 'disabled', 'minPrice', 'maxPrice'])
      ? parseCounts({ active: discounts.active, ended: discounts.ended, disabled: discounts.disabled }) : null;
    if (!rule || !discounts || !counts || !priceRange(discounts, 'minPrice', 'maxPrice')) return null;
    goods.push({ id: row.id, name: row.name, code: row.code as string | null, archived: row.archived, rule, skip: row.skip as string | null,
      priceMin: row.priceMin as number | null, priceMax: row.priceMax as number | null,
      discounts: { ...counts, minPrice: discounts.minPrice as number | null, maxPrice: discounts.maxPrice as number | null } });
  }
  return { ...summary, checkedAt: value.checkedAt, stopReceipt, goods };
}
export function parseDiscountPromotionTargetOptions(value: unknown): DiscountPromotionTargetOptions | null {
  if (!record(value) || !exact(value, ['campaigns', 'ips']) || !Array.isArray(value.campaigns) || value.campaigns.length > 200 || !Array.isArray(value.ips)) return null;
  /* 고를 수 없는 모양의 행(옛 IP 주소 등)은 목록에서만 뺀다 — 한 줄 때문에 새 프로모션 화면 전체를 막지 않는다. 서버가 다시 검증한다. */
  const campaigns: DiscountPromotionTargetOptions['campaigns'] = [];
  for (const row of value.campaigns) {
    if (!record(row) || !exact(row, ['id', 'title', 'status', 'startsAt', 'endsAt', 'goodsCount'])) return null;
    if (!validCampaignId(row.id) || !boundedText(row.title, 200) || !['draft', 'published', 'ended'].includes(String(row.status))
      || !instant(row.startsAt) || !instant(row.endsAt) || !integer(row.goodsCount, 0, 1000)) continue;
    campaigns.push({ id: row.id, title: row.title, status: row.status as string, startsAt: row.startsAt, endsAt: row.endsAt, goodsCount: row.goodsCount });
  }
  const ips: DiscountPromotionTargetOptions['ips'] = [];
  for (const row of value.ips) {
    if (!record(row) || !exact(row, ['id', 'title', 'goodsCount'])) return null;
    if (!validIpId(row.id) || !boundedText(row.title, 200) || !integer(row.goodsCount, 0, 1_000_000)) continue;
    ips.push({ id: row.id, title: row.title, goodsCount: row.goodsCount });
  }
  return { campaigns, ips };
}

export function discountPromotionError(code: string | null): string {
  const messages: Record<string, string> = {
    discount_promotion_invalid: '프로모션 이름·기간·대상·할인 값을 확인해주세요.',
    discount_promotion_period_ended: '종료 시각이 이미 지났습니다. 기간을 확인해주세요.',
    discount_promotion_campaign_unavailable: '선택한 기획전(캠페인)을 찾을 수 없습니다. 목록을 새로고침해주세요.',
    discount_promotion_ip_unavailable: '선택한 IP를 찾을 수 없거나 보관되었습니다. 목록을 새로고침해주세요.',
    discount_promotion_good_unavailable: '선택한 상품 중 찾을 수 없는 상품이 있습니다. 상품을 다시 선택해주세요.',
    discount_promotion_no_goods: '대상에 상품이 없습니다. 기획전 본문의 상품 묶음 블록이나 IP의 상품을 확인해주세요.',
    discount_promotion_target_limit: `한 프로모션은 상품 ${DISCOUNT_PROMOTION_GOODS_LIMIT.toLocaleString('ko-KR')}개까지 걸 수 있습니다. 대상을 나눠 주세요.`,
    discount_promotion_exception_outside_target: '대상에 없는 상품의 예외가 있습니다. 대상을 다시 확인한 뒤 예외를 정해주세요.',
    discount_promotion_all_skipped: '모든 상품이 건너뛰기 대상입니다. 기간이 겹치는 할인이나 할인 금액을 확인해주세요.',
    discount_promotion_busy: '다른 작업이 같은 상품을 바꾸고 있습니다. 잠시 뒤 다시 확인해주세요.',
    discount_promotion_changed: '비교 이후 상품의 옵션·가격·기간 할인이 바뀌었습니다. 다시 확인해주세요.',
    discount_promotion_preview_expired: '비교 결과의 15분 유효기간이 지났습니다. 다시 확인해주세요.',
    discount_promotion_operation_conflict: '같은 요청번호로 다른 내용을 확인했습니다. 다시 확인해주세요.',
    discount_promotion_operation_unavailable: '이 요청의 결과를 확인할 수 없습니다. 화면을 다시 열어주세요.',
    discount_promotion_not_found: '프로모션을 찾을 수 없습니다. 목록을 새로고침해주세요.',
    discount_promotion_already_stopped: '이미 중지된 프로모션입니다. 화면을 새로고침해주세요.',
    discount_promotion_ended: '이미 끝난 프로모션이라 중지할 할인이 없습니다.',
    price_period_overlap: '시간이 겹치는 활성 할인이 생겼습니다. 다시 확인해주세요.',
    goods_group_auth_changed: '로그인 계정 또는 세션이 변경되었습니다. 화면을 다시 열어주세요.',
    operator_capability_required: '상품 관리 권한이 필요합니다.',
  };
  return messages[code ?? ''] ?? '할인 프로모션을 처리하지 않았습니다. 입력과 상품 상태를 확인해주세요.';
}
