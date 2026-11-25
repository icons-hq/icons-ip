import { isUuid } from '@/lib/uuid';
import { transactionExactKeys as exact, transactionInstant as instant, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { validGoodsGroupGoodId } from './goods-groups';
import { GOODS_PRICE_GUARD_INTRO, GOODS_PRICE_GUARD_TITLE, formatGoodsPriceGuardList, goodsPriceGuardRows } from './goods-price-guard';
import { parseGoodsPricePeriodInput } from './goods-price-periods';
import { goodsOptionSaleModeErrorMessage } from './goods-option-sale-mode-messages';
import { ADMIN_STOCK_LABELS } from './vocabulary';

export const GOODS_BULK_COMMANDS = ['publish', 'unpublish', 'start', 'stop', 'archive', 'restore', 'price', 'discount', 'discount_stop', 'period', 'dissolve'] as const;
export type GoodsBulkCommand = typeof GOODS_BULK_COMMANDS[number];
/** `ip`: one IP expands to every non-archived good of that IP (discount commands only, up to 1,000). */
export type GoodsBulkKind = 'goods' | 'groups' | 'ip';
export const GOODS_BULK_IP_LIMIT = 1000;
const IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
/**
 * 건너뛰는 이유(표의 한 칸에 들어가는 짧은 말). 미리보기가 상품마다 정해 두고, 저장은 건너뛴 상품을 빼고 적용한다.
 * 할인은 겹침·할인가를 직접 판정하고, 그 밖의 명령은 DB가 저장과 같은 함수로 시험 적용해 막힌 이유를 그대로 싣는다(20261126120000).
 */
export const GOODS_BULK_SKIP_LABELS: Record<string, string> = {
  price_period_overlap: '기간이 겹치는 할인이 이미 있음',
  price_period_variant_inactive: '판매 중인 옵션이 없음',
  goods_bulk_price_invalid: '할인가가 1원 미만이거나 판매가 이상',
  no_active_discount: '진행 중이거나 예정된 기간 할인이 없음',
  /* TKT-033: 한 상품 한 시점 할인 하나 — 기간 없는 즉시할인(정가 표시) 상품에는 기간 할인·프로모션을 겹쳐 걸지 않는다. */
  instant_discount_active: '기간 없는 즉시할인이 이미 있음(상품 수정의 즉시할인에서 관리)',
  good_archived: '보관된 상품(먼저 복원)',
  goods_bulk_busy: '다른 사람이 저장하는 중(잠시 뒤 다시)',
  goods_bulk_already_published: '이미 공개',
  goods_bulk_already_draft: '이미 초안',
  goods_publish_incomplete: '대표 이미지·상품정보제공고시·옵션 가운데 빠진 것이 있음',
  goods_category_required: '대표 카테고리가 없음',
  goods_kc_review_required: 'KC 검토가 끝나지 않음',
  goods_notice_required: '상품정보제공고시가 비어 있음',
  fulfillment_origin_required: '출고지가 없음',
  fulfillment_origin_inactive: '쓰지 않는 출고지가 연결됨',
  parent_archived: 'IP가 보관됨(IP를 먼저 복원)',
  goods_bulk_not_stopped: '판매중지가 아님',
  goods_bulk_already_stopped: '이미 판매중지',
  goods_bulk_already_archived: '이미 보관',
  goods_bulk_not_archived: '보관된 상품이 아님',
  good_has_stock: '재고수량이 남아 있음(0으로 맞춘 뒤 보관)',
  good_has_active_policy: '예전 카드팩 발급 정책에 연결됨(개발팀에 요청)',
  active_price_period_requires_reset: '진행 중이거나 예정된 기간 할인이 있음(먼저 중지)',
  goods_compare_at_price_invalid: '새 판매가가 정가(할인 전 판매가) 이상',
  goods_sale_period_preorder_conflict: '예약판매 중(판매기간을 넣을 수 없음)',
};
/** 할인 중지 비교에서 상품이 잃게 될 진행·예정 기간 할인(개별로 걸어 둔 할인 포함). */
export interface GoodsBulkActiveDiscounts { count: number; minPrice: number; maxPrice: number; startsAt: string; endsAt: string }
/** 상품 1개 할인 중지(includeInstant)가 함께 멈출 기간 없는 즉시할인: 판매가(할인 전)와 지금 할인가(TKT-033). */
export interface GoodsBulkInstantDiscount { regularPrice: number; salePrice: number }
/** `command`를 주면 같은 코드가 명령마다 다른 뜻일 때 그 명령의 말로 옮긴다(판매가 변경의 금액 범위). */
export function goodsBulkSkipLabel(reason: string, command?: GoodsBulkCommand) {
  if (reason === 'goods_bulk_price_invalid' && command === 'price') return '새 판매가가 1원보다 작거나 너무 큼';
  if (RANDOM_OPTION_PROBLEMS.some(problem => problem === reason)) return '랜덤 판매 조건에 맞지 않음(상품 수정의 판매 방식에서 확인)';
  return GOODS_BULK_SKIP_LABELS[reason] ?? '지금은 바꿀 수 없음(상품 수정에서 확인)';
}
export interface GoodsBulkSkipped { id: string; name: string; code: string | null; reason: string }
export interface GoodsBulkRequest { kind: GoodsBulkKind; ids: string[]; command: GoodsBulkCommand; values: Record<string, string | number | boolean | null> }
export type GoodsBulkStock = 'ok' | 'low' | 'soldout';
/**
 * 미리보기 한 줄. `skip`이 있으면 저장할 때 건너뛴다. `stock`(판매상태 값)은 판매상태 명령에만, `saleStartsAt`·`saleEndsAt`(지금 판매기간)은
 * 판매기간 명령에만 싣는다(20261126120000부터 — 그 전에 만든 미리보기에는 없다).
 */
export interface GoodsBulkGood { id: string; name: string; code: string | null; price: number; nextPrice: number; priceMin: number | null; priceMax: number | null; nextMin: number | null; nextMax: number | null; published: boolean; archived: boolean; stopped: boolean; skip?: string | null; discounts?: GoodsBulkActiveDiscounts | null; instantDiscount?: GoodsBulkInstantDiscount; stock?: GoodsBulkStock; saleStartsAt?: string | null; saleEndsAt?: string | null }
export interface GoodsBulkPreview { state: 'ready'; operationId: string; request: GoodsBulkRequest; groups: { id: string; name: string; revision: number }[]; goods: GoodsBulkGood[]; expiresAt: string }
export interface GoodsBulkReceipt { state: 'completed' | 'rejected' | 'unresolved' | 'sealed'; operationId: string; goodsCount: number; groupsCount: number; error: string | null; skipped?: GoodsBulkSkipped[] }
/** 명령 이름. 선택 카드·창 제목·미리보기 요약이 함께 쓴다. */
export const GOODS_BULK_LABELS: Record<GoodsBulkCommand, string> = { publish: '공개로', unpublish: '초안으로', start: '판매중으로', stop: '판매중지로', archive: '보관', restore: '복원', price: '판매가 변경', discount: '기간 할인 걸기', discount_stop: '기간 할인 중지', period: '판매기간 변경', dissolve: '그룹 해제' };
/** 판매상태 값의 화면 이름. 어드민 공통 이름(lib/admin/vocabulary의 ADMIN_STOCK_LABELS)을 그대로 쓴다. */
export const GOODS_BULK_STOCK_LABELS: Record<GoodsBulkStock, string> = ADMIN_STOCK_LABELS;
/** 결과를 모를 때의 버튼 한 쌍과 문장(어드민 공통). */
export const GOODS_BULK_RECOVER_LABEL = '저장됐는지 확인';
export const GOODS_BULK_SEAL_LABEL = '그만두고 다시 하기';
export const GOODS_BULK_UNCERTAIN = `저장됐는지 확인하지 못했습니다. [${GOODS_BULK_RECOVER_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.`;
export const GOODS_BULK_UNRESOLVED = `아직 저장된 기록이 없습니다. 잠시 뒤 [${GOODS_BULK_RECOVER_LABEL}]을 다시 눌러주세요.`;

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
  } else if (command === 'discount_stop' && !exact(v, [])) {
    /* 목록 판매가 칸의 '할인 중지 후 판매가 변경'만 상품 1개에 기간 없는 즉시할인까지 멈춘다(TKT-033). */
    if (!exact(v, ['includeInstant']) || v.includeInstant !== true || value.kind !== 'goods' || value.ids.length !== 1) return null;
  } else if (command !== 'period' && command !== 'discount_stop' && !exact(v, [])) return null;
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
function instantDiscount(value: unknown): value is GoodsBulkInstantDiscount {
  return record(value) && exact(value, ['regularPrice', 'salePrice']) && integer(value.regularPrice, 1, 2_147_483_647)
    && integer(value.salePrice, 0, 2_147_483_647) && Number(value.salePrice) < Number(value.regularPrice);
}
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
    if (!record(row) || !exact(row, [...keys, ...['skip', 'discounts', 'instantDiscount', 'stock', 'saleStartsAt', 'saleEndsAt'].filter(key => Object.hasOwn(row, key))])
      || Object.hasOwn(row, 'instantDiscount') && !(request.command === 'discount_stop' && request.values.includeInstant === true && instantDiscount(row.instantDiscount))
      || !(row.skip === undefined || row.skip === null || typeof row.skip === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(row.skip))
      || !(row.discounts === undefined || row.discounts === null || request.command === 'discount_stop' && activeDiscounts(row.discounts))
      || !(row.stock === undefined || ['ok', 'low', 'soldout'].includes(String(row.stock)))
      || ['saleStartsAt', 'saleEndsAt'].some(key => !(row[key] === undefined || row[key] === null || instant(row[key])))
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
  /* 할인은 적용할 상품이 없으면 DB가 미리보기부터 거절한다. 그 밖의 명령은 모두 건너뛰어도 상품마다 이유를 보여 주려고 받는다(저장은 거절된다). */
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
/**
 * 바꿀 수 있는 상품이 하나도 없을 때(`goods_bulk_all_skipped`)의 문장. 기간 할인 걸기·중지는 DB가 상품마다의 이유를 싣지 않고
 * 미리보기부터 거절하므로(20261126120000), 그 명령에서 상품을 건너뛰는 이유를 모두 적는다 — 하나만 적으면 운영자가 엉뚱한 칸을 고친다.
 * 그 밖의 명령은 미리보기가 상품마다 이유를 보여 주므로 이 문장은 그사이 상태가 바뀐 저장에서만 나온다.
 */
const GOODS_BULK_ALL_SKIPPED: Partial<Record<GoodsBulkCommand, string>> = {
  discount: '기간 할인을 걸 수 있는 상품이 없습니다. 기간이 겹치는 할인이나 기간 없는 즉시할인이 이미 있는 상품, 사용 중인 옵션이 없는 상품, 할인가가 1원 미만이 되는 상품, 보관된 상품에는 걸 수 없습니다. 기간·금액을 바꾸거나, 상품 수정에서 즉시할인과 옵션을 확인한 뒤 다시 해주세요.',
  discount_stop: '멈출 기간 할인이 없습니다. 고른 상품은 보관됐거나, 진행 중이거나 예정된 기간 할인이 없습니다.',
};
/**
 * 일괄 변경이 통째로 멈췄을 때, 그리고 상품 1개짜리 변경(목록 바로 수정)이 건너뛰어졌을 때의 문장.
 * 무엇이 문제인지와 다음에 할 일을 함께 쓴다. 표 한 칸에 들어가는 짧은 말은 `goodsBulkSkipLabel`이다.
 * `command`를 알면 같은 코드라도 그 명령에 맞는 말로 쓴다(바꿀 수 있는 상품이 없을 때).
 */
export function goodsBulkError(code: string | null, command?: GoodsBulkCommand): string {
  if (code === 'goods_bulk_all_skipped' && command && GOODS_BULK_ALL_SKIPPED[command]) return GOODS_BULK_ALL_SKIPPED[command];
  const messages: Record<string, string> = {
    goods_bulk_changed: '확인한 뒤에 상품·옵션·재고가 바뀌어 아무것도 바꾸지 않았습니다. 지금 내용으로 다시 확인해주세요.',
    goods_bulk_busy: '같은 상품을 다른 사람이 저장하고 있습니다. 잠시 뒤 다시 해주세요.',
    goods_bulk_preview_expired: '확인한 지 15분이 지나 아무것도 바꾸지 않았습니다. 다시 확인해주세요.',
    goods_bulk_target_limit: '한 번에 상품 100개(IP 전체 할인은 1,000개)까지 바꿀 수 있습니다. 상품을 줄여 다시 골라주세요.',
    goods_bulk_all_skipped: '바꿀 수 있는 상품이 없습니다. 상품의 지금 상태를 확인한 뒤 다시 해주세요.',
    goods_bulk_no_active_discount: '멈출 기간 할인이 없습니다. 진행 중이거나 예정된 할인만 멈출 수 있습니다.',
    instant_discount_period_conflict: '진행 중이거나 예정된 기간 할인이 있으면 기간 없는 즉시할인을 함께 걸 수 없습니다. 기간 할인을 먼저 중지해주세요.',
    active_price_period_requires_reset: '진행 중이거나 예정된 기간 할인이 있으면 판매가를 바꿀 수 없습니다. 기간 할인을 먼저 중지해주세요.',
    goods_bulk_ip_unavailable: '고른 IP를 찾을 수 없거나 보관됐습니다. 목록을 새로고침해주세요.',
    goods_bulk_group_unavailable: '고른 그룹이 바뀌었거나 해제됐습니다. 목록을 새로고침해주세요.',
    goods_bulk_price_invalid: '새 판매가나 할인가가 1원보다 작거나 너무 큽니다. 금액을 다시 입력해주세요.',
    goods_compare_at_price_invalid: '새 판매가가 정가(할인 전 판매가)보다 크거나 같습니다. 상품 수정의 즉시할인에서 금액을 먼저 고쳐주세요.',
    price_period_overlap: '기간이 겹치는 할인이 이미 걸려 있습니다. 걸려 있는 할인을 중지하거나 기간을 바꿔주세요.',
    goods_sale_period_preorder_conflict: '예약판매 중인 상품에는 판매기간을 넣을 수 없습니다. 상품 수정의 판매 시기에서 일반 재고 판매로 바꾼 뒤 다시 해주세요.',
    good_has_stock: '재고수량이 남은 상품은 보관할 수 없습니다. 재고수량을 0으로 맞춘 뒤 보관해주세요.',
    good_has_active_policy: '예전 카드팩 발급 정책에 연결된 상품은 보관할 수 없습니다. 개발팀에 정책 정리를 요청해주세요.',
    good_archived: '보관된 상품은 바꿀 수 없습니다. 먼저 복원해주세요.',
    goods_kc_review_required: 'KC 검토가 끝나지 않아 공개할 수 없습니다. 상품 수정의 KC 정보에서 검토를 마쳐주세요.',
    goods_category_required: '대표 카테고리가 없어 공개할 수 없습니다. 상품 수정에서 대표 카테고리를 골라주세요.',
    goods_notice_required: '상품정보제공고시가 비어 있어 공개할 수 없습니다. 상품 수정에서 고시를 채워주세요.',
    goods_publish_incomplete: '대표 이미지·상품정보제공고시·옵션 가운데 빠진 것이 있어 공개할 수 없습니다. 상품 수정에서 채워주세요.',
    fulfillment_origin_required: '출고지가 없어 공개할 수 없습니다. 상품 수정에서 출고지를 골라주세요.',
    fulfillment_origin_inactive: '쓰지 않는 출고지가 연결돼 있어 공개할 수 없습니다. 상품 수정에서 사용 중인 출고지를 골라주세요.',
    parent_archived: 'IP가 보관돼 있어 바꿀 수 없습니다. IP를 먼저 복원해주세요.',
    goods_bulk_already_published: '이미 공개된 상품입니다. 새로고침해 지금 상태를 확인해주세요.',
    goods_bulk_already_draft: '이미 초안인 상품입니다. 새로고침해 지금 상태를 확인해주세요.',
    goods_bulk_not_stopped: '판매중지인 상품이 아닙니다. 새로고침해 지금 판매상태를 확인해주세요.',
    goods_bulk_already_stopped: '이미 판매중지인 상품입니다. 새로고침해 지금 판매상태를 확인해주세요.',
    goods_bulk_already_archived: '이미 보관된 상품입니다. 새로고침해 지금 상태를 확인해주세요.',
    goods_bulk_not_archived: '보관된 상품이 아닙니다. 새로고침해 지금 상태를 확인해주세요.',
    goods_group_auth_changed: '로그인한 계정이 바뀌었거나 다시 로그인했습니다. 화면을 새로고침해주세요.',
    operator_capability_required: '상품을 바꿀 권한이 없습니다. 최고 관리자에게 매니저 관리에서 상품 관리 권한을 요청해주세요.',
  };
  return messages[code ?? ''] ?? '아무것도 바꾸지 않았습니다. 상품의 판매 준비와 입력한 금액·기간을 확인한 뒤 다시 해주세요.';
}

/** 상품 1개짜리 변경(목록 바로 수정)이 건너뛰어졌을 때의 문장. 랜덤 판매 조건은 판매 방식 화면과 같은 문장을 쓴다. */
export function goodsBulkSkipMessage(reason: string): string {
  return RANDOM_OPTION_PROBLEMS.some(problem => problem === reason) ? goodsOptionSaleModeErrorMessage(reason) : goodsBulkError(reason);
}

/** 일괄 변경 창의 입력값. `value`·`startsAt`·`endsAt`은 입력칸 글자 그대로다(시각은 `datetime-local`, KST). */
export interface GoodsBulkFormFields { mode: string; value: string; periodMode: 'range' | 'none'; startsAt: string; endsAt: string }
/** 변경 방식의 단위. 고른 방식에 맞춰 금액 칸 뒤에 붙인다. */
export function goodsBulkModeUnit(mode: string): '원' | '%' { return mode === 'rate' || mode.startsWith('percent_') ? '%' : '원'; }
/**
 * 창의 입력을 요청 값으로 옮긴다. 틀린 칸이 있으면 어느 칸이 왜 안 되는지 돌려준다(서버로 보내지 않는다).
 * 판매기간은 '기간 없이 계속 판매'(periodMode 'none')면 날짜 칸을 읽지 않는다 — 두 선택이 함께 열려 날짜가 버려지는 일이 없다.
 */
export function goodsBulkFormValues(command: GoodsBulkCommand, fields: GoodsBulkFormFields): { values: Record<string, string | number | null> } | { error: string } {
  const values: Record<string, string | number | null> = {};
  if (command === 'price' || command === 'discount') {
    const unit = goodsBulkModeUnit(fields.mode), name = unit === '%' ? '비율' : '금액';
    const text = fields.value.replaceAll(',', '').trim(), amount = Number(text);
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(amount)) return { error: `${name}은 1 이상의 숫자로 입력해주세요.` };
    if (amount > 2_147_483_647) return { error: '금액이 너무 큽니다. 2,147,483,647원 이하로 입력해주세요.' };
    if (fields.mode === 'rate' && amount >= 100) return { error: '할인 비율은 99% 이하로 입력해주세요.' };
    if (fields.mode === 'percent_decrease' && amount >= 100) return { error: '내리는 비율은 99% 이하로 입력해주세요.' };
    if (fields.mode === 'percent_increase' && amount > 1000) return { error: '올리는 비율은 1,000% 이하로 입력해주세요.' };
    values.mode = fields.mode; values.value = amount;
  }
  if (command === 'period' && fields.periodMode === 'none') { values.startsAt = null; values.endsAt = null; }
  else if (command === 'period' || command === 'discount') {
    const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: fields.startsAt, endsAt: fields.endsAt });
    if (!parsed || !parsed.startsAt || !parsed.endsAt) return { error: '시작 (KST)과 종료 (KST)를 모두 입력해주세요. 종료는 시작보다 늦어야 합니다.' };
    values.startsAt = parsed.startsAt; values.endsAt = parsed.endsAt;
  }
  return { values };
}

/**
 * 일괄 판매가 변경을 적용하기 전 오입력 확인(CAT-008). 비교 결과의 기본 판매가가 0원·1,000원 미만이거나 이전 금액의 절반 이하·
 * 두 배 이상으로 바뀌는 상품을 이전 → 새 값으로 보인다. 판매가 변경이 아니거나 해당 상품이 없으면 null.
 */
export function goodsBulkPriceConfirmation(preview: Pick<GoodsBulkPreview, 'request' | 'goods'>): { title: string; message: string; confirmLabel: string } | null {
  if (preview.request.command !== 'price') return null;
  const lines = goodsPriceGuardRows(preview.goods.filter((row) => !row.skip), (row) => ({ label: row.name, before: row.price, after: row.nextPrice }));
  if (!lines.length) return null;
  return {
    title: GOODS_PRICE_GUARD_TITLE,
    message: `${GOODS_PRICE_GUARD_INTRO}\n\n${formatGoodsPriceGuardList(lines)}\n\n맞으면 ${preview.goods.filter((row) => !row.skip).length.toLocaleString('ko-KR')}개 상품에 판매가 변경을 적용합니다.`,
    confirmLabel: '이대로 적용',
  };
}

export function goodsBulkShippingHref(ids: string[]) { return `/admin/settings/shipping-templates?goods=${encodeURIComponent(ids.join(','))}`; }
export function parseGoodsBulkShippingIds(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const ids = value.split(',');
  return ids.length <= 100 && ids.every(validGoodsGroupGoodId) && new Set(ids).size === ids.length ? ids : [];
}
