import { describe, expect, it } from 'vitest';
import { GROUP_COMMON_DB_FIELDS, normalizeGoodsGroupCommonForm, parseGoodsEditorOwnership, parseGoodsGroupCommonSnapshot } from './goods-group-common';
import { commonTestForm, commonTestOwnership, commonTestRaw } from './goods-group-common.test-fixtures';

describe('그룹 공통정보의 읽기·저장 경계', () => {
  it('그룹 버전과 같은 읽기의 모든 공통 값과 A/S·사이즈를 가져온다', () => {
    expect(parseGoodsGroupCommonSnapshot(commonTestRaw)).toMatchObject({ group: commonTestRaw.group, fields: { nameEn: 'Common name', noticeAsManager: 'A/S 담당자', searchKeywords: '검색어' } });
    expect(parseGoodsGroupCommonSnapshot({ ...commonTestRaw, afterSales: { ...commonTestRaw.afterSales, goodId: 'another-good' } })).toBeNull();
    expect(parseGoodsGroupCommonSnapshot({ ...commonTestRaw, sizeChart: { ...commonTestRaw.sizeChart, goodId: 'another-good' } })).toBeNull();
    expect(parseGoodsGroupCommonSnapshot({ ...commonTestRaw, common: { ...commonTestRaw.common, goods: { ...commonTestRaw.common.goods, price: 2 } } })).toBeNull();
  });
  it('그룹 전체 공통 입력만 RPC에 전달하고 개별 가격·재고·이미지·결제·배송은 버린다', () => {
    const form = commonTestForm();
    for (const key of ['name', 'price', 'variants', 'imagePath', 'allowCardPayment', 'originId', 'published', 'intent', 'id']) form.set(key, 'attacker-value');
    const parsed = normalizeGoodsGroupCommonForm(form);
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error('invalid');
    expect(Object.keys(parsed.values.goods).sort()).toEqual([...GROUP_COMMON_DB_FIELDS, 'additional_category_ids'].sort());
    expect(parsed.values).toMatchObject({ goods: { category_id: null, additional_category_ids: [], name_en: 'Common name' }, afterSales: { phone: '', guide: '', sellerSpecialNotes: '' }, attributes: { expectedRevision: 0 } });
    expect(JSON.stringify(parsed.values)).not.toContain('attacker-value');
  });
  it.each([
    ['categoryId','invalid'], ['additionalCategoryIds','invalid'], ['productAttributes','{}'], ['groupAfterSales','{}'],
    ['groupSizeChart','{}'], ['descriptionFormat','script'], ['nameEn','x'.repeat(201)], ['description','x'.repeat(2001)],
  ])('잘못된 공통 입력을 거절한다: %s', (key, value) => { const form = commonTestForm(); form.set(key, value); expect(normalizeGoodsGroupCommonForm(form).ok).toBe(false); });
  it('HTML은 기존 정리기와 이미지 경로 계약으로 정규화한다', () => {
    const form = commonTestForm(); form.set('descriptionFormat','html'); form.set('description','<script>alert(1)</script><h2>설명</h2><img src="https://example.com/image.png" onerror="alert(1)">');
    const parsed = normalizeGoodsGroupCommonForm(form); expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    expect(String(parsed.values.goods.description)).not.toContain('onerror'); expect(String(parsed.values.goods.description)).not.toContain('<script');
    expect(parsed.values.goods.description_image_paths).toEqual([]);
  });
  it('하위상품은 원상품의 합산 조건을 읽으며 미설정 출고지도 허용한다', () => {
    expect(parseGoodsEditorOwnership(commonTestOwnership)).toMatchObject({ goodId: 'group-child', aggregation: { editable: false, ownerGoodId: 'group-source' } });
    const standalone = { goodId: 'standalone', group: null, aggregation: { ...commonTestOwnership.aggregation, goodId: 'standalone', ownerGoodId: 'standalone', aggregationId: null, shared: false, editable: true, sharedPolicy: { ...commonTestOwnership.aggregation.sharedPolicy, originId: null } } };
    expect(parseGoodsEditorOwnership(standalone)?.aggregation.sharedPolicy.originId).toBeNull();
  });
  it.each([{ goodId: 'unrelated' }, { group: { ...commonTestRaw.group, archivedAt: '2026-10-14T00:00:00Z' } }, { aggregation: { ...commonTestOwnership.aggregation, editable: true } }, { aggregation: { ...commonTestOwnership.aggregation, sharedPolicy: { ...commonTestOwnership.aggregation.sharedPolicy, originId: 'bad' } } }])('다른 대상·소유권·비정상 정책 응답을 거절한다: %j', patch => expect(parseGoodsEditorOwnership({ ...commonTestOwnership, ...patch })).toBeNull());
});
