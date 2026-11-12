import { describe, expect, it } from 'vitest';
import {
  emptyGoodWorkspaceFulfillment, emptyGoodWorkspaceProduction, emptyGoodWorkspaceTerms, goodWorkspaceExtraSectionFailure,
  parseGoodWorkspaceExtraSections, prepareGoodWorkspaceExtraSections,
} from './good-workspace-extra-sections';
import { goodWorkspacePublishRejection, parseGoodWorkspaceSections, prepareGoodWorkspaceSections, EMPTY_GOOD_WORKSPACE_SECTIONS } from './good-workspace-sections';
import { goodsOptionRowKey, initialGoodsOptionRows, type GoodsOptionRow } from './goods-option-editor';

/* T15b(1027T-024 "저장 전 전부 입력"): 등록 화면의 나머지 설정 13개를 첫 저장에 함께 싣는 제출 계약. */
const red: GoodsOptionRow = { ...initialGoodsOptionRows([], 10000)[0], name: '빨강', attributes: { 색상: '빨강' } };
const saved: GoodsOptionRow = { ...red, id: '11111111-1111-4111-8111-111111111111', name: '저장된 옵션', attributes: { 색상: '파랑' } };
const rows = [red, saved];

describe('나머지 설정 제출(prepare)', () => {
  it('기본값 그대로인 섹션은 보내지 않아 기존 저장과 같은 결과를 낸다', () => {
    expect(prepareGoodWorkspaceExtraSections(undefined, rows)).toEqual({ ok: true, value: {} });
    expect(prepareGoodWorkspaceExtraSections({
      optionSaleMode: 'select', purchaseCosts: [{ optionKey: goodsOptionRowKey(red), unitCostKrw: '', taxBasis: '' }], pricePeriods: [], additional: [],
      benefits: { eventText: ' ', giftText: '', giftImagePaths: [''] }, afterSales: { phone: '', guide: '', sellerSpecialNotes: '' },
      sizeChart: { enabled: false, chart: { unit: 'cm', sizes: [], measurements: [], note: '' } }, listingColors: [], transactionTerms: emptyGoodWorkspaceTerms(),
      shippingChargeGroup: null, subscriptionPolicy: { enabled: false, intervals: [], message: '' }, fulfillment: emptyGoodWorkspaceFulfillment(), production: emptyGoodWorkspaceProduction(),
    }, rows)).toEqual({ ok: true, value: {} });
    /* KC·예약판매만 있던 기존 제출 모양도 그대로다. */
    expect(prepareGoodWorkspaceSections(EMPTY_GOOD_WORKSPACE_SECTIONS, rows, false)).toEqual({ ok: true, value: { kc: null, preorders: [] } });
  });

  it('채운 섹션을 기존 패널과 같은 규칙으로 확인해 옵션은 참조(id·옵션값 조합)로 싣는다', () => {
    const prepared = prepareGoodWorkspaceExtraSections({
      optionSaleMode: 'random',
      purchaseCosts: [{ optionKey: goodsOptionRowKey(red), unitCostKrw: '4000', taxBasis: 'included' }],
      pricePeriods: [{ key: 'p1', optionKey: goodsOptionRowKey(saved), state: 'active', discountPrice: '9000', startsAt: '2026-12-01T00:00', endsAt: '2026-12-02T00:00' }],
      additional: [{ goodId: 'other-good', name: '다른 상품', available: true }],
      benefits: { eventText: '이벤트', giftText: '사은품', giftImagePaths: [''] },
      afterSales: { phone: '02-1234-5678', guide: 'A/S 안내', sellerSpecialNotes: '' },
      listingColors: [{ label: ' 빨강 ', hex: '#FF0000' }],
      transactionTerms: { ...emptyGoodWorkspaceTerms(), volume: { status: 'draft', fields: { ...emptyGoodWorkspaceTerms().volume.fields, threshold: '2' } } },
      shippingChargeGroup: { id: '22222222-2222-4222-8222-222222222222', revision: 3, originId: 'origin' },
      subscriptionPolicy: { enabled: true, intervals: ['month_1'], message: ' 안내 ' },
      production: { ...emptyGoodWorkspaceProduction(), enabled: true, leadDays: '5', evidence: '근거', confirmed: true },
    }, rows, { canManageCosts: true });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const value = prepared.value;
    expect(value.optionSaleMode).toBe('random');
    expect(value.purchaseCosts).toEqual([{ variant: { attributes: { 색상: '빨강' } }, unitCostKrw: 4000, taxBasis: 'included' }]);
    expect(value.pricePeriods).toEqual([{ variant: { id: saved.id }, period: { state: 'active', discountPrice: 9000, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-01T15:00:00.000Z' } }]);
    expect(value.additional).toEqual(['other-good']);
    expect(value.benefits).toEqual({ eventText: '이벤트', giftText: '사은품', giftImagePaths: [] });
    expect(value.listingColors).toEqual([{ label: '빨강', hex: '#ff0000' }]);
    expect(value.transactionTerms?.volume).toMatchObject({ status: 'draft', terms: null });
    expect(value.transactionTerms).not.toHaveProperty('delivery');
    expect(value.shippingChargeGroup).toEqual({ groupId: '22222222-2222-4222-8222-222222222222', expectedRevision: 3 });
    expect(value.subscriptionPolicy).toEqual({ enabled: true, intervals: ['month_1'], message: '안내' });
    expect(value.production).toMatchObject({ enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], confirmed: true });
    /* 서버 액션이 같은 제출을 다시 확인한다. */
    const parsed = parseGoodWorkspaceSections(JSON.stringify({ kc: null, preorders: [], ...value }), true);
    expect(parsed).toMatchObject({ ok: true, sections: { optionSaleMode: 'random', additional: ['other-good'], shippingChargeGroup: { expectedRevision: 3 } } });
  });

  it('채우다 만 섹션은 그 섹션 칸에 알리고 저장하지 않는다', () => {
    const field = (extras: Parameters<typeof prepareGoodWorkspaceExtraSections>[0], canManageCosts = true) => {
      const result = prepareGoodWorkspaceExtraSections(extras, rows, { canManageCosts });
      return result.ok ? null : result.field;
    };
    expect(field({ purchaseCosts: [{ optionKey: goodsOptionRowKey(red), unitCostKrw: '4000', taxBasis: '' }] })).toBe('workspaceCosts');
    expect(field({ purchaseCosts: [{ optionKey: goodsOptionRowKey(red), unitCostKrw: '4000', taxBasis: 'included' }] }, false)).toBe('workspaceCosts');
    expect(field({ pricePeriods: [{ key: 'p', optionKey: 'gone', state: 'draft', discountPrice: '1', startsAt: '', endsAt: '' }] })).toBe('workspacePrices');
    expect(field({ pricePeriods: [{ key: 'p', optionKey: goodsOptionRowKey(red), state: 'active', discountPrice: '', startsAt: '', endsAt: '' }] })).toBe('workspacePrices');
    expect(field({ afterSales: { phone: '02-1', guide: '', sellerSpecialNotes: '' } })).toBe('workspaceAfterSales');
    expect(field({ benefits: { eventText: '', giftText: '', giftImagePaths: ['public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp'] } })).toBe('workspaceBenefits');
    expect(field({ sizeChart: { enabled: true, chart: { unit: 'cm', sizes: [], measurements: [], note: '' } } })).toBe('workspaceSizeChart');
    expect(field({ listingColors: [{ label: '빨강', hex: '#ff0000' }, { label: '빨강', hex: '#00ff00' }] })).toBe('workspaceListingColors');
    expect(field({ subscriptionPolicy: { enabled: true, intervals: [], message: '' } })).toBe('workspaceSubscriptionPolicy');
    expect(field({ fulfillment: { ...emptyGoodWorkspaceFulfillment(), mode: 'no_delivery' } })).toBe('workspaceFulfillment');
    expect(field({ production: { ...emptyGoodWorkspaceProduction(), enabled: true, leadDays: '3', evidence: '근거' } })).toBe('workspaceProduction');
    expect(field({ transactionTerms: { ...emptyGoodWorkspaceTerms(), volume: { status: 'active', fields: emptyGoodWorkspaceTerms().volume.fields } } })).toBe('workspaceTransactionTerms');
  });

  it('수령 방식은 택배 기본값이 아니면 근거·확인과 함께 기존 저장 값 모양으로 싣는다', () => {
    const fulfillment = { ...emptyGoodWorkspaceFulfillment(), mode: 'no_delivery' as const, evidence: '직접 전달', confirmed: true };
    const prepared = prepareGoodWorkspaceExtraSections({ fulfillment }, rows);
    expect(prepared).toEqual({ ok: true, value: { fulfillment: { mode: 'no_delivery', methods: [{ method: 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }],
      assetIds: [], publicNote: '', evidence: '직접 전달', confirmed: true } } });
  });
});

describe('나머지 설정 서버 확인(parse)', () => {
  it('매입단가는 관리자만 싣고, 형식이 틀린 섹션은 그 섹션 오류다', () => {
    const costs = { purchaseCosts: [{ variant: { attributes: { 색상: '빨강' } }, unitCostKrw: 4000, taxBasis: 'included' }] };
    expect(parseGoodWorkspaceExtraSections(costs)).toMatchObject({ ok: false, field: 'workspaceCosts' });
    expect(parseGoodWorkspaceExtraSections(costs, { canManageCosts: true })).toMatchObject({ ok: true, value: costs });
    expect(parseGoodWorkspaceExtraSections({ optionSaleMode: 'select' })).toMatchObject({ ok: false, field: 'workspaceOptionSaleMode' });
    /* 단품의 옵션값 조합은 빈 객체다(정상). 배열·폐기 상태는 형식 오류다. */
    expect(parseGoodWorkspaceExtraSections({ pricePeriods: [{ variant: { attributes: {} }, period: { state: 'draft' } }] })).toMatchObject({ ok: true });
    expect(parseGoodWorkspaceExtraSections({ pricePeriods: [{ variant: { attributes: [] }, period: { state: 'draft' } }] })).toMatchObject({ ok: false, field: 'workspacePrices' });
    expect(parseGoodWorkspaceExtraSections({ pricePeriods: [{ variant: { attributes: {} }, period: { state: 'disabled' } }] })).toMatchObject({ ok: false, field: 'workspacePrices' });
    expect(parseGoodWorkspaceExtraSections({ shippingChargeGroup: { groupId: 'x', expectedRevision: 1 } })).toMatchObject({ ok: false, field: 'workspaceShippingChargeGroup' });
    expect(parseGoodWorkspaceExtraSections({ production: { enabled: false, leadDays: null, dayBasis: 'calendar', closedDates: [], publicNote: '', evidence: '근거', confirmed: false } }))
      .toMatchObject({ ok: false, field: 'workspaceProduction' });
    /* 알 수 없는 섹션 이름은 기존처럼 거절한다. */
    expect(parseGoodWorkspaceSections(JSON.stringify({ stock: [] }), true)).toMatchObject({ ok: false });
  });
});

describe('섹션 실패·공개 결과 안내', () => {
  it('래퍼가 섹션 이름을 담아 던진 실패를 그 섹션 칸에 알린다', () => {
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:purchaseCosts:operator_capability_required', '42501'))
      .toEqual({ workspaceCosts: expect.stringContaining('관리자 계정') });
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:shippingChargeGroup:shipping_charge_group_changed', 'PT409'))
      .toEqual({ workspaceShippingChargeGroup: expect.stringContaining('다시 골라주세요') });
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:production:invalid_parameter_value', '22023'))
      .toEqual({ workspaceProduction: expect.stringContaining('상품은 저장되지 않았고 입력은 유지됩니다.') });
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:unknown:boom')).toBeNull();
    expect(goodWorkspaceExtraSectionFailure('goods_kc_review_changed')).toBeNull();
  });

  it('저장 후 공개가 거절되면 저장은 끝났다고 말하고 이유를 고른다', () => {
    expect(goodWorkspacePublishRejection({ requested: true, published: true, error: null })).toBeNull();
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'goods_kc_review_required' })).toMatchObject({ kc: true });
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'goods_publish_incomplete' })?.message).toContain('대표 이미지');
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'fulfillment_origin_required' })?.message).toContain('출고지');
    /* 공개 결과를 못 받았으면 공개했다고 하지 않는다. */
    expect(goodWorkspacePublishRejection(undefined)).toMatchObject({ kc: false, message: expect.stringContaining('저장했지만 공개하지 않았습니다') });
  });
});
