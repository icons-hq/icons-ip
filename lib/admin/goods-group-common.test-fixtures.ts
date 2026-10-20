import { groupTestGroup as group, groupTestId as id, groupTestIdentity as identity } from './goods-groups.test-fixtures';
import { GROUP_COMMON_DB_FIELDS, parseGoodsGroupCommonSnapshot } from './goods-group-common';
import { emptyGoodsSizeChartValues } from '@/lib/goods-size-chart';

export const commonTestRaw = {
  group,
  common: { goods: { ...Object.fromEntries(GROUP_COMMON_DB_FIELDS.map(key => [key, null])), ip_id: 'sample-ip', type: '문구', description_format: 'plain', description_image_paths: [], search_keywords: ['검색어'], name_en: 'Common name', notice_as_manager: 'A/S 담당자' }, attributes: [], additionalCategories: [], afterSales: null, sizeChart: null },
  afterSales: { goodId: group.commonGoodId, goodName: 'TEST 원상품', phone: '', guide: '', sellerSpecialNotes: '', revision: 0, updatedAt: null },
  sizeChart: { goodId: group.commonGoodId, goodName: 'TEST 원상품', values: emptyGoodsSizeChartValues(), revision: 0, updatedAt: null },
};
export const commonTestSnapshot = () => parseGoodsGroupCommonSnapshot(structuredClone(commonTestRaw))!;
export const commonTestMetadata = { ...identity, version: 1 as const, command: 'common' as const, groupId: group.id, expectedRevision: 1, operationId: id(45) };
export const commonTestReceipt = { state: 'completed' as const, operationId: commonTestMetadata.operationId, group: { ...group, revision: 2 } };
export function commonTestForm() {
  const snapshot = commonTestSnapshot(), form = new FormData();
  Object.entries(snapshot.fields).forEach(([name, value]) => form.set(name, value));
  form.set('productAttributes', JSON.stringify({ categoryId: null, schemaRevision: 0, expectedRevision: 0, values: {}, removeIds: [] }));
  form.set('groupAfterSales', JSON.stringify(snapshot.afterSales)); form.set('groupSizeChart', JSON.stringify(snapshot.sizeChart.values));
  return form;
}
export const commonTestOwnership = { goodId: 'group-child', group, aggregation: { goodId: 'group-child', ownerGoodId: group.commonGoodId, aggregationId: id(46), shared: true, editable: false,
  sharedPolicy: { originId: id(47), shippingFeeType: 'free', individualFee: 0, orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 20, memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 40 } } };
