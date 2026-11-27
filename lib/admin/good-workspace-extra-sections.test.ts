import { describe, expect, it } from 'vitest';
import {
  emptyGoodWorkspaceFulfillment, emptyGoodWorkspaceProduction, emptyGoodWorkspaceTerms, goodWorkspaceExtraSectionFailure, isDefaultGoodWorkspaceFulfillment,
  parseGoodWorkspaceExtraSections, prepareGoodWorkspaceExtraSections, pruneGoodWorkspaceExtras,
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
      production: { ...emptyGoodWorkspaceProduction(), enabled: true, leadDays: '5' },
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
    /* 주문 후 제작은 설정 근거·확인 체크 없이 필요한 값만 싣는다(2026-11-25 결정). */
    expect(value.production).toEqual({ enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: '' });
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
    expect(field({ fulfillment: { ...emptyGoodWorkspaceFulfillment(), mode: 'digital' } })).toBe('workspaceFulfillment');
    expect(field({ fulfillment: { ...emptyGoodWorkspaceFulfillment(), methods: emptyGoodWorkspaceFulfillment().methods.map((method) => ({ ...method, enabled: false })) } })).toBe('workspaceFulfillment');
    expect(field({ production: { ...emptyGoodWorkspaceProduction(), enabled: true } })).toBe('workspaceProduction');
    expect(field({ production: { ...emptyGoodWorkspaceProduction(), enabled: true, leadDays: '0' } })).toBe('workspaceProduction');
    expect(field({ transactionTerms: { ...emptyGoodWorkspaceTerms(), volume: { status: 'active', fields: emptyGoodWorkspaceTerms().volume.fields } } })).toBe('workspaceTransactionTerms');
  });

  /* 2026-11-25 결정: 저장 = 적용. 수령 방식·주문 후 제작은 설정 근거·확인 체크 없이 필요한 값만 넣으면 저장된다. */
  it('수령 방식은 택배 기본값이 아니면 설정 근거·확인 체크 없이 고른 값만 싣는다', () => {
    const fulfillment = { ...emptyGoodWorkspaceFulfillment(), mode: 'no_delivery' as const };
    const prepared = prepareGoodWorkspaceExtraSections({ fulfillment }, rows);
    expect(prepared).toEqual({ ok: true, value: { fulfillment: { mode: 'no_delivery', methods: [{ method: 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }],
      assetIds: [], publicNote: '' } } });
    const quick = { ...emptyGoodWorkspaceFulfillment(), publicNote: '설치 기사가 방문합니다',
      methods: emptyGoodWorkspaceFulfillment().methods.map((method) => method.method === 'quick' ? { ...method, enabled: true, amount: '3000', basis: 'per_item' as const, installation: '2000' } : method) };
    expect(prepareGoodWorkspaceExtraSections({ fulfillment: quick }, rows)).toEqual({ ok: true, value: { fulfillment: { mode: 'shipping', methods: [
      { method: 'parcel', feeAmount: null, feeBasis: 'per_order', installationFee: 0 }, { method: 'quick', feeAmount: 3000, feeBasis: 'per_item', installationFee: 2000 },
    ], assetIds: [], publicNote: '설치 기사가 방문합니다' } } });
  });

  /* 브라우저 확인 F4: 택배 외 방식을 받지 않는 쇼핑몰 설정에서 퀵을 켰다가 다시 끄면, 남은 금액 때문에 '바뀐 설정'으로 실려 상품이 계속 등록되지 않았다. */
  it('수령 방식은 저장될 값으로 기본값을 가린다 — 켰다 끈 방식에 남은 금액은 싣지 않는다', () => {
    const empty = emptyGoodWorkspaceFulfillment();
    expect(isDefaultGoodWorkspaceFulfillment(empty)).toBe(true);
    const leftover = { ...empty, methods: empty.methods.map((method) => method.method === 'quick' ? { ...method, amount: '8000', basis: 'per_item' as const, installation: '500' } : method) };
    expect(isDefaultGoodWorkspaceFulfillment(leftover)).toBe(true);
    expect(prepareGoodWorkspaceExtraSections({ fulfillment: leftover }, rows)).toEqual({ ok: true, value: {} });
    /* 저장될 값이 달라지는 것은 모두 '바뀐 설정'이다: 다른 방식, 택배 설치비, 고객 안내, 제공 방식, 숫자가 아닌 금액, 아무것도 안 고름. */
    const withMethod = (name: string, patch: Partial<typeof empty.methods[number]>) => ({ ...empty, methods: empty.methods.map((method) => method.method === name ? { ...method, ...patch } : method) });
    for (const changed of [withMethod('quick', { enabled: true }), withMethod('parcel', { installation: '3000' }), withMethod('parcel', { installation: '' }),
      withMethod('parcel', { enabled: false }), { ...empty, publicNote: '설치 기사가 방문합니다' }, { ...empty, mode: 'no_delivery' as const }, { ...empty, mode: 'digital' as const }]) {
      expect(isDefaultGoodWorkspaceFulfillment(changed)).toBe(false);
    }
  });
  it('쇼핑몰 설정 때문에 수령 방식·주문 후 제작이 거절되면 무엇을 남기면 되는지와 누구에게 요청하는지 말한다', () => {
    const fulfillment = goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:fulfillment:transaction_runtime_disabled', 'PT409')!.workspaceFulfillment!;
    expect(fulfillment).toBe('지금 쇼핑몰 설정에서는 수령 방식을 저장할 수 없습니다. 상품을 등록하는 중이면 택배만 켜고 설치비 0원, 고객 안내는 비워 두면 등록됩니다. 다른 방식을 써야 하면 개발 담당자에게 요청해 주세요. 상품은 저장되지 않았고 입력은 유지됩니다.');
    const production = goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:production:transaction_runtime_disabled', 'PT409')!.workspaceProduction!;
    expect(production).toBe('지금 쇼핑몰 설정에서는 주문 후 제작을 켠 채로 저장할 수 없습니다. 끄고 저장하거나, 써야 하면 개발 담당자에게 요청해 주세요. 상품은 저장되지 않았고 입력은 유지됩니다.');
    for (const message of [fulfillment, production]) expect(message).not.toContain('운영 설정');
  });

  it('주문 후 제작은 켜고 발송 예정 기간만 넣으면 실리고, 끄면 싣지 않는다', () => {
    const on = { ...emptyGoodWorkspaceProduction(), enabled: true, leadDays: '7', dayBasis: 'business' as const, closedDates: '2026-12-25\n2027-01-01', publicNote: '주문 뒤 만듭니다' };
    expect(prepareGoodWorkspaceExtraSections({ production: on }, rows)).toEqual({ ok: true, value: { production: {
      enabled: true, leadDays: 7, dayBasis: 'business', closedDates: ['2026-12-25', '2027-01-01'], publicNote: '주문 뒤 만듭니다' } } });
    expect(prepareGoodWorkspaceExtraSections({ production: { ...on, enabled: false } }, rows)).toEqual({ ok: true, value: {} });
  });

  it('새 입력 모양에는 설정 근거·확인 체크 칸이 없다', () => {
    expect(Object.keys(emptyGoodWorkspaceFulfillment()).sort()).toEqual(['files', 'methods', 'mode', 'publicNote']);
    expect(Object.keys(emptyGoodWorkspaceProduction()).sort()).toEqual(['closedDates', 'dayBasis', 'enabled', 'leadDays', 'publicNote']);
  });
});

describe('옵션이 바뀐 뒤 남은 매입단가 입력', () => {
  const redKey = goodsOptionRowKey(red);
  const stale = { purchaseCosts: [{ optionKey: redKey, unitCostKrw: '4000', taxBasis: 'included' as const }] };
  const renamed: GoodsOptionRow = { ...red, name: '레드', attributes: { 색상: '레드' } };
  const single: GoodsOptionRow = { ...initialGoodsOptionRows([], 10000)[0] };

  it('옵션값을 바꾸면 옛 키의 입력은 정리되고 저장 준비가 성공한다', () => {
    const pruned = pruneGoodWorkspaceExtras(stale, [renamed]);
    expect(pruned?.purchaseCosts).toEqual([]);
    expect(prepareGoodWorkspaceExtraSections(pruned, [renamed], { canManageCosts: true })).toEqual({ ok: true, value: {} });
  });
  it('단품에서 옵션으로 바꿔도 옛 단품 키의 입력이 막지 않는다', () => {
    const singleKey = goodsOptionRowKey(single);
    const costs = { purchaseCosts: [{ optionKey: singleKey, unitCostKrw: '3000', taxBasis: 'excluded' as const }] };
    expect(pruneGoodWorkspaceExtras(costs, [red])?.purchaseCosts).toEqual([]);
    expect(prepareGoodWorkspaceExtraSections(costs, [red], { canManageCosts: true })).toEqual({ ok: true, value: {} });
  });
  it('정리 전에도 prepare는 지금 행에 없는 키를 무시하고, 남은 행의 입력은 싣는다', () => {
    const mixed = { purchaseCosts: [...stale.purchaseCosts, { optionKey: goodsOptionRowKey(saved), unitCostKrw: '5000', taxBasis: 'included' as const }] };
    const prepared = prepareGoodWorkspaceExtraSections(mixed, [renamed, saved], { canManageCosts: true });
    expect(prepared).toMatchObject({ ok: true, value: { purchaseCosts: [{ variant: { id: saved.id }, unitCostKrw: 5000 }] } });
    expect(pruneGoodWorkspaceExtras(mixed, [renamed, saved])?.purchaseCosts).toHaveLength(1);
  });
  it('정리할 것이 없으면 같은 객체를 돌려준다', () => {
    expect(pruneGoodWorkspaceExtras(stale, [red])).toBe(stale);
    expect(pruneGoodWorkspaceExtras(undefined, [red])).toBeUndefined();
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
    /* 수령 방식·주문 후 제작: 설정 근거·확인 체크 없는 모양만 받는다. 알 수 없는 키(옛 evidence·confirmed 포함)나 빠진 키는 그 섹션 오류다. */
    const production = { enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: '' };
    const fulfillment = { mode: 'shipping', methods: [{ method: 'parcel', feeAmount: null, feeBasis: 'per_order', installationFee: 0 }], assetIds: [], publicNote: '' };
    expect(parseGoodWorkspaceExtraSections({ production, fulfillment })).toEqual({ ok: true, value: { production, fulfillment } });
    expect(parseGoodWorkspaceExtraSections({ production: { ...production, evidence: '근거', confirmed: true } })).toMatchObject({ ok: false, field: 'workspaceProduction' });
    expect(parseGoodWorkspaceExtraSections({ production: { ...production, publicNote: undefined } })).toMatchObject({ ok: false, field: 'workspaceProduction' });
    expect(parseGoodWorkspaceExtraSections({ fulfillment: { ...fulfillment, evidence: '근거', confirmed: true } })).toMatchObject({ ok: false, field: 'workspaceFulfillment' });
    expect(parseGoodWorkspaceExtraSections({ fulfillment: { ...fulfillment, methods: [] } })).toMatchObject({ ok: false, field: 'workspaceFulfillment' });
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
      .toEqual({ workspaceProduction: '발송 예정 기간(1~365일)·기간 계산 기준·휴무일 날짜를 확인해주세요. 상품은 저장되지 않았고 입력은 유지됩니다.' });
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:fulfillment:invalid_parameter_value', '22023'))
      .toEqual({ workspaceFulfillment: '수령 방식·비용·디지털 파일을 확인해주세요. 상품은 저장되지 않았고 입력은 유지됩니다.' });
    /* 근거 칸이 없으므로 어느 안내도 근거를 고치라고 하지 않는다. */
    for (const section of ['production', 'fulfillment']) for (const code of ['22023', 'PT409', '42501', 'XX000']) {
      expect(JSON.stringify(goodWorkspaceExtraSectionFailure(`goods_workspace_section_failed:${section}:boom`, code))).not.toMatch(/근거|요청/);
    }
    expect(goodWorkspaceExtraSectionFailure('goods_workspace_section_failed:unknown:boom')).toBeNull();
    expect(goodWorkspaceExtraSectionFailure('goods_kc_review_changed')).toBeNull();
  });

  it('저장 후 공개가 거절되면 저장은 끝났다고 말하고 이유를 고른다', () => {
    expect(goodWorkspacePublishRejection({ requested: true, published: true, error: null })).toBeNull();
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'goods_kc_review_required' })).toMatchObject({ kc: true });
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'goods_publish_incomplete' })?.message).toContain('대표 이미지');
    expect(goodWorkspacePublishRejection({ requested: true, published: false, error: 'fulfillment_origin_required' })?.message).toContain('출고지');
    /* 공개 결과를 못 받았으면 공개했다고 하지 않는다. */
    expect(goodWorkspacePublishRejection(undefined)).toMatchObject({ kc: false, message: expect.stringContaining('초안으로 저장했고 아직 공개하지 않았습니다') });
  });
});
