import { isUuid } from '@/lib/uuid';
import { transactionExactKeys as exact, transactionInstant as instant, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { validGoodsGroupGoodId } from './goods-groups';

export const GOODS_BULK_COMMANDS = ['publish', 'unpublish', 'start', 'stop', 'archive', 'restore', 'price', 'discount', 'discount_stop', 'period', 'dissolve'] as const;
export type GoodsBulkCommand = typeof GOODS_BULK_COMMANDS[number];
/** `ip`: one IP expands to every non-archived good of that IP (discount commands only, up to 1,000). */
export type GoodsBulkKind = 'goods' | 'groups' | 'ip';
export const GOODS_BULK_IP_LIMIT = 1000;
const IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** Discount previews freeze per-good skips; commit applies only the remaining goods. */
export const GOODS_BULK_SKIP_LABELS: Record<string, string> = {
  price_period_overlap: '기간이 겹치는 즉시할인이 이미 있음',
  price_period_variant_inactive: '판매 중인 옵션이 없음',
  goods_bulk_price_invalid: '할인가가 1원 미만이거나 판매가 이상',
  no_active_discount: '중지할 진행·예정 할인이 없음',
};
/** 할인 중지 비교에서 상품이 잃게 될 진행·예정 기간 할인(개별로 걸어 둔 할인 포함). */
export interface GoodsBulkActiveDiscounts { count: number; minPrice: number; maxPrice: number; startsAt: string; endsAt: string }
export function goodsBulkSkipLabel(reason: string) { return GOODS_BULK_SKIP_LABELS[reason] ?? '적용할 수 없는 상품'; }
export interface GoodsBulkSkipped { id: string; name: string; code: string | null; reason: string }
export interface GoodsBulkRequest { kind: GoodsBulkKind; ids: string[]; command: GoodsBulkCommand; values: Record<string, string | number | null> }
export interface GoodsBulkGood { id: string; name: string; code: string | null; price: number; nextPrice: number; priceMin: number | null; priceMax: number | null; nextMin: number | null; nextMax: number | null; published: boolean; archived: boolean; stopped: boolean; skip?: string | null; discounts?: GoodsBulkActiveDiscounts | null }
export interface GoodsBulkPreview { state: 'ready'; operationId: string; request: GoodsBulkRequest; groups: { id: string; name: string; revision: number }[]; goods: GoodsBulkGood[]; expiresAt: string }
export interface GoodsBulkReceipt { state: 'completed' | 'rejected' | 'unresolved' | 'sealed'; operationId: string; goodsCount: number; groupsCount: number; error: string | null; skipped?: GoodsBulkSkipped[] }
export const GOODS_BULK_LABELS: Record<GoodsBulkCommand, string> = { publish: '전시중으로 변경', unpublish: '전시 중지', start: '판매 재개', stop: '판매 중지', archive: '선택 보관', restore: '선택 복원', price: '판매가 변경', discount: '즉시할인 등록', discount_stop: '기간 할인 중지', period: '판매기간 변경', dissolve: '그룹 해제' };

export function parseGoodsBulkRequest(value: unknown): GoodsBulkRequest | null {
  if (!record(value) || !exact(value, ['kind', 'ids', 'command', 'values']) || !['goods', 'groups', 'ip'].includes(String(value.kind))
    || !GOODS_BULK_COMMANDS.includes(value.command as GoodsBulkCommand) || !Array.isArray(value.ids) || value.ids.length < 1 || value.ids.length > (value.kind === 'ip' ? 1 : 100)
    || value.ids.some(id => value.kind === 'goods' ? !validGoodsGroupGoodId(id) : value.kind === 'ip' ? typeof id !== 'string' || !IP_ID.test(id) : !isUuid(id)) || new Set(value.ids).size !== value.ids.length
    || value.command === 'dissolve' && value.kind !== 'groups' || value.kind === 'ip' && value.command !== 'discount' && value.command !== 'discount_stop' || !record(value.values)) return null;
  const v = value.values, command = value.command as GoodsBulkCommand;
  if (command === 'price' || command === 'discount') {
    if (!integer(v.value, 1, 2_147_483_647) || typeof v.mode !== 'string'
      || (command === 'price' ? !exact(v, ['mode', 'value']) || !['set', 'increase', 'decrease', 'percent_increase', 'percent_decrease'].includes(v.mode)
        : !exact(v, ['mode', 'value', 'startsAt', 'endsAt']) || !['amount', 'rate'].includes(v.mode))
      || ['percent_decrease', 'rate'].includes(v.mode) && v.value >= 100 || v.mode === 'percent_increase' && v.value > 1000) return null;
  } else if (command !== 'period' && !exact(v, [])) return null;
  if (command === 'period' || command === 'discount') {
    if (command === 'period' && !exact(v, ['startsAt', 'endsAt'])) return null;
    const unlimited = command === 'period' && v.startsAt === null && v.endsAt === null;
    if (!unlimited && (!instant(v.startsAt) || !instant(v.endsAt) || Date.parse(v.startsAt) >= Date.parse(v.endsAt))) return null;
  }
  return { kind: value.kind as GoodsBulkKind, ids: [...value.ids] as string[], command, values: { ...v } as GoodsBulkRequest['values'] };
}
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && [...value].length <= max; }
function activeDiscounts(value: unknown): value is GoodsBulkActiveDiscounts {
  return record(value) && exact(value, ['count', 'minPrice', 'maxPrice', 'startsAt', 'endsAt']) && integer(value.count, 1, 10_000)
    && integer(value.minPrice, 1, 2_147_483_647) && integer(value.maxPrice, 1, 2_147_483_647) && Number(value.minPrice) <= Number(value.maxPrice)
    && instant(value.startsAt) && instant(value.endsAt) && Date.parse(String(value.startsAt)) < Date.parse(String(value.endsAt));
}
const money = (value: unknown) => integer(value, 0, 2_147_483_647);
export function parseGoodsBulkPreview(value: unknown, expectedId: string, request: GoodsBulkRequest): GoodsBulkPreview | null {
  if (!record(value) || !exact(value, ['state', 'operationId', 'request', 'groups', 'goods', 'expiresAt']) || value.state !== 'ready' || value.operationId !== expectedId || !isUuid(expectedId)
    || !instant(value.expiresAt) || !Array.isArray(value.groups) || value.groups.length > 100 || !Array.isArray(value.goods) || value.goods.length < 1
    || value.goods.length > (request.kind === 'ip' ? GOODS_BULK_IP_LIMIT : 100)) return null;
  const received = parseGoodsBulkRequest(value.request);
  if (!received || received.kind !== request.kind || received.command !== request.command || JSON.stringify([...received.ids].sort()) !== JSON.stringify([...request.ids].sort())
    || Object.keys(request.values).length !== Object.keys(received.values).length || Object.entries(request.values).some(([key, val]) => received.values[key] !== val)) return null;
  const groupIds = new Set<string>(), goodIds = new Set<string>();
  for (const row of value.groups) {
    if (!record(row) || !exact(row, ['id', 'name', 'revision']) || !isUuid(row.id) || groupIds.has(row.id) || !boundedText(row.name, 40) || !integer(row.revision, 1)) return null;
    groupIds.add(row.id);
  }
  for (const row of value.goods) {
    const keys = ['id', 'name', 'code', 'price', 'nextPrice', 'priceMin', 'priceMax', 'nextMin', 'nextMax', 'published', 'archived', 'stopped'];
    if (!record(row) || !exact(row, [...keys, ...['skip', 'discounts'].filter(key => Object.hasOwn(row, key))])
      || !(row.skip === undefined || row.skip === null || typeof row.skip === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(row.skip))
      || row.skip && request.command !== 'discount' && request.command !== 'discount_stop'
      || !(row.discounts === undefined || row.discounts === null || request.command === 'discount_stop' && activeDiscounts(row.discounts))
      || !validGoodsGroupGoodId(row.id) || goodIds.has(row.id) || !boundedText(row.name, 200) || row.code !== null && !boundedText(row.code, 120)
      || !money(row.price) || !money(row.nextPrice) || ['published', 'archived', 'stopped'].some(key => typeof row[key] !== 'boolean')) return null;
    for (const [min, max] of [['priceMin', 'priceMax'], ['nextMin', 'nextMax']]) {
      if (row[min] === null && row[max] === null) continue;
      if (!money(row[min]) || !money(row[max]) || Number(row[min]) > Number(row[max])) return null;
    }
    goodIds.add(row.id);
  }
  if (request.kind === 'goods' ? groupIds.size !== 0 || goodIds.size !== request.ids.length || request.ids.some(id => !goodIds.has(id))
    : request.kind === 'ip' ? groupIds.size !== 0
    : groupIds.size !== request.ids.length || request.ids.some(id => !groupIds.has(id))) return null;
  if ((request.command === 'discount' || request.command === 'discount_stop') && value.goods.every(row => record(row) && row.skip)) return null;
  return value as unknown as GoodsBulkPreview;
}
export function parseGoodsBulkReceipt(value: unknown, expectedId: string): GoodsBulkReceipt | null {
  const keys = ['state', 'operationId', 'goodsCount', 'groupsCount', 'error'];
  if (!record(value) || !exact(value, Object.hasOwn(value, 'skipped') ? [...keys, 'skipped'] : keys) || value.operationId !== expectedId || !isUuid(expectedId)
    || !['completed', 'rejected', 'unresolved', 'sealed'].includes(String(value.state)) || !integer(value.goodsCount, 0, GOODS_BULK_IP_LIMIT) || !integer(value.groupsCount, 0, 100)
    || value.skipped !== undefined && (value.state !== 'completed' || !Array.isArray(value.skipped) || value.skipped.length > GOODS_BULK_IP_LIMIT
      || value.skipped.some(row => !record(row) || !exact(row, ['id', 'name', 'code', 'reason']) || !validGoodsGroupGoodId(row.id) || !boundedText(row.name, 200)
        || row.code !== null && !boundedText(row.code, 120) || typeof row.reason !== 'string' || !/^[a-z][a-z0-9_]{0,100}$/.test(row.reason)))
    || (value.state === 'completed' ? value.goodsCount < 1 || value.error !== null : value.goodsCount !== 0 || value.groupsCount !== 0)
    || (value.state === 'rejected' ? typeof value.error !== 'string' || !/^[a-z][a-z0-9_]{0,100}$/.test(value.error) : value.error !== null)) return null;
  return value as unknown as GoodsBulkReceipt;
}
export function goodsBulkError(code: string | null): string {
  const messages: Record<string, string> = {
    goods_bulk_changed: '비교 이후 상품·옵션·재고가 변경되었습니다. 최신 내용으로 다시 확인해주세요.',
    goods_bulk_busy: '다른 작업이 진행 중입니다. 최신 내용으로 다시 확인해주세요.',
    goods_bulk_preview_expired: '비교 결과의 15분 유효기간이 지났습니다. 다시 확인해주세요.',
    goods_bulk_target_limit: '한 번에 개별 상품 100개(IP 전체 적용은 1,000개)까지 변경할 수 있습니다. 대상 수를 줄여주세요.',
    goods_bulk_all_skipped: '모든 상품이 건너뛰기 대상입니다. 기간이 겹치는 할인이나 할인 금액을 확인해주세요.',
    goods_bulk_no_active_discount: '중지할 진행 중이거나 예정된 즉시할인이 없습니다.',
    active_price_period_requires_reset: '진행 중이거나 예정된 즉시할인이 있는 상품은 판매가를 바꿀 수 없습니다. 해당 상품의 즉시할인을 먼저 중지해주세요.',
    goods_bulk_ip_unavailable: '선택한 IP를 찾을 수 없거나 보관되었습니다. 목록을 새로고침해주세요.',
    goods_bulk_group_unavailable: '선택한 그룹이 변경되거나 해제되었습니다. 목록을 새로고침해주세요.',
    goods_bulk_price_invalid: '변경할 판매가·할인가가 허용 범위를 벗어납니다. 금액과 옵션 가격을 확인해주세요.',
    goods_compare_at_price_invalid: '새 판매가가 표시용 정가 이상입니다. 해당 상품의 정가를 먼저 확인해주세요.',
    price_period_overlap: '시간이 겹치는 활성 할인이 있습니다. 기존 할인을 중지하거나 기간을 변경해주세요.',
    goods_sale_period_preorder_conflict: '예약판매 중인 상품은 일반 판매기간을 설정할 수 없습니다.',
    good_has_stock: '할당 재고가 남아 있는 상품은 보관할 수 없습니다. 재고를 확인해주세요.',
    good_archived: '보관된 상품이 포함되어 있습니다. 복원한 뒤 변경해주세요.',
    goods_kc_review_required: '공개 전 KC 검토가 필요한 상품이 있습니다. 해당 상품을 확인해주세요.',
    goods_notice_required: '공개에 필요한 상품정보제공고시를 먼저 입력해주세요.',
    goods_group_auth_changed: '로그인 계정 또는 세션이 변경되었습니다. 화면을 다시 열어주세요.',
    operator_capability_required: '상품 관리 권한이 필요합니다.',
  };
  return messages[code ?? ''] ?? '일괄 변경을 적용하지 않았습니다. 상품의 판매 준비·현재 상태와 입력값을 확인해주세요.';
}

export function goodsBulkShippingHref(ids: string[]) { return `/admin/settings/shipping-templates?goods=${encodeURIComponent(ids.join(','))}`; }
export function parseGoodsBulkShippingIds(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const ids = value.split(',');
  return ids.length <= 100 && ids.every(validGoodsGroupGoodId) && new Set(ids).size === ids.length ? ids : [];
}
