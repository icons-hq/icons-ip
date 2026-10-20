import type { GoodsGroupConversionRequest, GoodsGroupPreview, GoodsGroupRecovery, GoodsGroupSnapshot, GoodsGroupSource } from './goods-groups';
export const groupTestId = (n: number) => `bc1d0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const groupTestIdentity = { actorId: groupTestId(90), sessionId: groupTestId(91) };
export const groupTestSource: GoodsGroupSource = { goodId: 'group-source', name: 'TEST 그룹', code: 'TEST-SOURCE', groupId: null, blockers: [], variants: [
  { id: groupTestId(1), name: '빨강', attributes: { 색상: '빨강' }, code: 'TEST-A', price: 10000, stockQty: 7 },
  { id: groupTestId(2), name: '파랑', attributes: { 색상: '파랑' }, code: 'TEST-B', price: 12000, stockQty: 11 },
] };
export const groupTestRequest: GoodsGroupConversionRequest = { sourceGoodId: groupTestSource.goodId, name: groupTestSource.name, optionNames: ['색상'],
  selections: groupTestSource.variants.map(row => ({ variantId: row.id, values: [row.name] })) };
export const groupTestGroup: GoodsGroupSnapshot = { id: groupTestId(10), name: 'TEST 그룹', optionNames: ['색상'], commonGoodId: groupTestSource.goodId, revision: 1, archivedAt: null,
  members: groupTestSource.variants.map((row, index) => ({ goodId: index === 0 ? groupTestSource.goodId : 'group-child', variantId: row.id, values: [row.name], sortOrder: index,
    name: `TEST 그룹 ${row.name}`, code: row.code, price: row.price, stockQty: row.stockQty, publishedAt: null, archivedAt: null })) };
export const groupTestPreview: Extract<GoodsGroupPreview, { state: 'ready' }> = { state: 'ready', previewId: groupTestId(11), expiresAt: '2099-10-14T00:00:00Z', plan: {
  sourceGoodId: groupTestSource.goodId, name: groupTestSource.name, optionNames: ['색상'], members: groupTestSource.variants.map((row, index) => ({ sourceVariantId: row.id, sourceVariantName: row.name,
    values: [row.name], retainsGoodId: index === 0, goodId: index === 0 ? groupTestSource.goodId : null, price: row.price, stockQty: row.stockQty, name: `TEST 그룹 ${row.name}` })),
  unselectedOptions: [], requiresKcReview: true, allProductsUnpublished: true, aggregationPreserved: true, historicalOrdersPreserved: true, unselectedStockPreserved: true, activeCartSelectionsRequireReview: true,
} };
export const groupTestRecovery: GoodsGroupRecovery = { version: 1, ...groupTestIdentity, command: 'convert', sourceGoodId: groupTestSource.goodId, previewId: groupTestPreview.previewId, operationId: groupTestId(12) };
export const groupTestReceipt = { state: 'completed' as const, operationId: groupTestRecovery.operationId, group: groupTestGroup, aggregationId: groupTestId(13) };
