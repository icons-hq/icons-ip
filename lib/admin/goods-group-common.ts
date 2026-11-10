import { normalizeAdminGoodForm } from './catalog';
import { goodSaveFields } from './good-save';
import { readGoodsAttributeSubmission } from './goods-attributes';
import { goodsGroupHref, parseGoodsGroupSnapshot, validGoodsGroupGoodId, type GoodsGroupSnapshot } from './goods-groups';
import { parseGoodsAfterSalesSnapshot, parseGoodsAfterSalesValues, type GoodsAfterSalesSnapshot } from '@/lib/goods-after-sales';
import { parseGoodsSizeChartSnapshot, parseGoodsSizeChartValues, type GoodsSizeChartSnapshot } from '@/lib/goods-size-chart';
import { parseGoodsTransactionOffers, type GoodsAggregationSharedPolicy } from '@/lib/goods-transaction-offers';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';

export const GROUP_COMMON_FIELDS = ['ipId', 'type', 'categoryId', 'additionalCategoryIds', 'nameEn', 'searchKeywords', 'description', 'descriptionFormat', ...GOODS_NOTICE_FIELDS.map(field => field.formName)] as const;
export const GROUP_COMMON_DB_FIELDS = ['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on','notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords'] as const;
export interface GoodsEditorOwnership { goodId: string; group: GoodsGroupSnapshot | null; aggregation: { ownerGoodId: string; aggregationId: string | null; shared: boolean; editable: boolean; sharedPolicy: Omit<GoodsAggregationSharedPolicy, 'originId'> & { originId: string | null } } }
export interface GoodsGroupCommonSnapshot { group: GoodsGroupSnapshot; fields: Record<string, string>; afterSales: GoodsAfterSalesSnapshot; sizeChart: GoodsSizeChartSnapshot }
export const goodsGroupCommonHref = (group: GoodsGroupSnapshot) => `/admin/catalog/goods?goodId=${encodeURIComponent(group.commonGoodId)}&groupCommon=${encodeURIComponent(group.id)}`;
export { goodsGroupHref };

export function parseGoodsEditorOwnership(value: unknown): GoodsEditorOwnership | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'group', 'aggregation']) || !validGoodsGroupGoodId(value.goodId) || !transactionRecord(value.aggregation)) return null;
  const group = value.group === null ? null : parseGoodsGroupSnapshot(value.group), aggregation = value.aggregation;
  if (value.group !== null && (!group || group.archivedAt !== null || !group.members.some(member => member.goodId === value.goodId))) return null;
  if (!transactionExactKeys(aggregation, ['goodId','ownerGoodId','aggregationId','sharedPolicy','shared','editable']) || aggregation.goodId !== value.goodId
    || !validGoodsGroupGoodId(aggregation.ownerGoodId) || typeof aggregation.shared !== 'boolean' || typeof aggregation.editable !== 'boolean'
    || aggregation.editable !== (aggregation.ownerGoodId === value.goodId) || (aggregation.shared ? !isUuid(aggregation.aggregationId) : aggregation.aggregationId !== null)) return null;
  if (!transactionRecord(aggregation.sharedPolicy) || aggregation.sharedPolicy.originId !== null && !isUuid(aggregation.sharedPolicy.originId)) return null;
  const offers = parseGoodsTransactionOffers([{ goodId: value.goodId, volume: null, delivery: null, collectReady: false, collector: null,
    aggregation: { id: aggregation.aggregationId ?? '00000000-0000-4000-8000-000000000001', requiresV2: true, runtimeEnabled: false }, sharedPolicy: { ...aggregation.sharedPolicy, originId: aggregation.sharedPolicy.originId ?? '00000000-0000-4000-8000-000000000001' } }]);
  if (!offers?.[0]?.sharedPolicy) return null;
  return { goodId: value.goodId, group, aggregation: { ownerGoodId: aggregation.ownerGoodId, aggregationId: aggregation.aggregationId as string | null,
    shared: aggregation.shared, editable: aggregation.editable, sharedPolicy: { ...offers[0].sharedPolicy, originId: aggregation.sharedPolicy.originId as string | null } } };
}

export function parseGoodsGroupCommonSnapshot(value: unknown): GoodsGroupCommonSnapshot | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['group','common','afterSales','sizeChart']) || !transactionRecord(value.common)) return null;
  const group = parseGoodsGroupSnapshot(value.group), afterSales = parseGoodsAfterSalesSnapshot(value.afterSales), sizeChart = parseGoodsSizeChartSnapshot(value.sizeChart), common = value.common;
  if (!group || group.archivedAt || !afterSales || !sizeChart || afterSales.goodId !== group.commonGoodId || sizeChart.goodId !== group.commonGoodId
    || !transactionExactKeys(common, ['goods','attributes','additionalCategories','afterSales','sizeChart']) || !transactionRecord(common.goods)
    || !transactionExactKeys(common.goods, [...GROUP_COMMON_DB_FIELDS]) || !Array.isArray(common.additionalCategories) || common.additionalCategories.some(id => !isUuid(id))) return null;
  const goods = common.goods;
  if (!validGoodsGroupGoodId(goods.ip_id) || goods.category_id !== null && !isUuid(goods.category_id) || !['plain','html'].includes(String(goods.description_format))
    || !Array.isArray(goods.search_keywords) || goods.search_keywords.some(word => typeof word !== 'string')
    || !Array.isArray(goods.description_image_paths) || goods.description_image_paths.some(path => typeof path !== 'string')
    || GROUP_COMMON_DB_FIELDS.filter(key => !['category_id','search_keywords','description_image_paths'].includes(key)).some(key => goods[key] !== null && typeof goods[key] !== 'string')) return null;
  const fields = { ipId: goods.ip_id, type: String(goods.type ?? ''), categoryId: goods.category_id ?? '', additionalCategoryIds: JSON.stringify(common.additionalCategories),
    nameEn: String(goods.name_en ?? ''), searchKeywords: goods.search_keywords.join('\n'), description: String(goods.description ?? ''), descriptionFormat: String(goods.description_format),
    ...Object.fromEntries(GOODS_NOTICE_FIELDS.map(field => [field.formName, goods[`notice_${field.key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`] ?? ''])) } as Record<string,string>;
  return { group, fields, afterSales, sizeChart };
}

/** Copy only group-owned inputs into the ordinary validators. Individual fields
 * in a submitted form are ignored; the database supplies their existing values. */
export function normalizeGoodsGroupCommonForm(input: FormData) {
  const form = new FormData();
  for (const field of GROUP_COMMON_FIELDS) form.set(field, String(input.get(field) ?? ''));
  form.set('name', '그룹 공통정보'); form.set('price', '0'); form.set('published', 'false');
  form.set('productAttributes', String(input.get('productAttributes') ?? ''));
  const normalized = normalizeAdminGoodForm(form, { ipIds: new Set([String(form.get('ipId'))]), goodIpById: new Map(), eventIds: new Set(), verticalKeys: new Set() });
  if (!normalized.ok) return { ok: false as const, errors: normalized.errors };
  const attributes = readGoodsAttributeSubmission(form);
  if (!attributes.ok || !attributes.fields.product_attributes) return { ok: false as const, errors: { productAttributes: '카테고리의 상품속성 조회를 마친 뒤 저장해주세요.' } };
  let afterSales, sizeChart;
  try { afterSales = parseGoodsAfterSalesValues(JSON.parse(String(input.get('groupAfterSales'))), true); sizeChart = parseGoodsSizeChartValues(JSON.parse(String(input.get('groupSizeChart')))); } catch { /* Invalid JSON cannot reach the RPC. */ }
  if (!afterSales || !sizeChart) return { ok: false as const, errors: { groupCommon: 'A/S 안내와 사이즈 안내 입력값을 확인해주세요.' } };
  const fields = goodSaveFields(normalized.value) as Record<string, unknown>;
  return { ok: true as const, values: { goods: Object.fromEntries([...GROUP_COMMON_DB_FIELDS,'additional_category_ids'].map(key => [key, fields[key]])),
    attributes: attributes.fields.product_attributes, afterSales, sizeChart } };
}
