import { describe, expect, it } from 'vitest';
import { GOOD_EDITOR_CARDS, GOOD_EDITOR_SECTIONS, goodFieldSection, goodKcContextChanged, goodPublishRequirements, goodReadinessAction, goodReadinessPlan, goodReadinessReasonAnchor, goodRemainingByCard, goodSaleSettingsState, goodTypeSuggestion, orderedGoodErrors } from './good-workspace';
import { GOODS_READINESS_REASONS, unknownGoodsReadiness, type AdminGoodsReadiness, type GoodsReadinessReasonCode } from './goods-readiness';

const values = { name: '상품', ipId: 'ip', type: '키링', imagePath: 'path', originId: 'origin', noticeMaker: 'a', noticeOrigin: 'b', noticeMaterial: 'c', noticeSize: 'd', noticeMadeOn: 'e', noticeAsManager: 'f', noticeAsContact: 'g' };

describe('상품 등록 카드와 필수 입력 안내', () => {
  it('카드 7장이 입력 섹션을 빠짐없이 한 번씩 묶는다', () => {
    expect(GOOD_EDITOR_CARDS.map((card) => card.key)).toEqual(['basic', 'sales', 'images', 'description', 'notice', 'delivery', 'additional']);
    expect(GOOD_EDITOR_CARDS.flatMap((card) => card.sections as readonly string[]).sort()).toEqual(GOOD_EDITOR_SECTIONS.map((section) => section.key as string).sort());
  });

  it('제출 칸은 그대로 옮긴 카드에 속하고 오류 순서는 화면 순서를 따른다', () => {
    expect(goodFieldSection('ipId').key).toBe('basic');
    expect(goodFieldSection('type').key).toBe('basic');
    expect(goodFieldSection('customInputs').key).toBe('information');
    expect(goodFieldSection('additionalCategoryIds').key).toBe('information');
    expect(goodFieldSection('showDiscountRate').key).toBe('information');
    /* 판매가 → 재고수량·옵션 다음에 판매기간·구매 제한, KC는 고시 바로 뒤. */
    expect(orderedGoodErrors({ workspacePreorders: 'p', maxOrderQty: 'l', variants: 'v', price: 'a', originId: 'o', workspaceKc: 'k', noticeMaker: 'n' }).map(([field]) => field))
      .toEqual(['price', 'variants', 'maxOrderQty', 'noticeMaker', 'workspaceKc', 'originId', 'workspacePreorders']);
  });

  it('공개까지 남은 필수 입력을 세고 카드별로 나눈다(판정은 서버가 한다)', () => {
    const done = goodPublishRequirements({ values, regularPrice: 12900, hasStock: true, kcDone: true });
    expect(done.filter((item) => !item.done)).toEqual([]);
    expect(done).toHaveLength(15);
    expect(goodRemainingByCard(done)).toEqual({ basic: 0, sales: 0, images: 0, notice: 0, delivery: 0 });

    const missing = goodPublishRequirements({ values: { ...values, type: ' ', imagePath: '', noticeMaker: '' }, regularPrice: 0, hasStock: false, kcDone: false });
    expect(missing.filter((item) => !item.done).map((item) => item.key)).toEqual(['type', 'regularPrice', 'stock', 'imagePath', 'noticeMaker', 'kc']);
    expect(goodRemainingByCard(missing)).toEqual({ basic: 1, sales: 2, images: 1, notice: 2, delivery: 0 });
    /* 필수 항목이 없는 카드는 표시하지 않는다. */
    expect(goodRemainingByCard(missing).description).toBeUndefined();
    expect(missing.find((item) => item.key === 'kc')?.anchor).toBe('good-operation-kc');
  });

  describe('판매 준비 주 행동(판정은 서버가 한다)', () => {
    const reason = (code: GoodsReadinessReasonCode, kind: 'blocking' | 'review' = 'blocking') => ({ code, ...GOODS_READINESS_REASONS[code], kind });
    const readiness = (...codes: GoodsReadinessReasonCode[]): AdminGoodsReadiness => ({ state: 'blocked', checkedAt: '2026-11-09T00:00:00Z', publication: 'draft', operation: 'active', availableQty: 1, publicReview: 'current', saleSettings: 'blocked', reviewRequired: true, reasons: codes.map((code) => reason(code)) });

    it('서버가 거절하는 항목을 먼저 내세우고 공개 버튼을 그리지 않는다', () => {
      const plan = goodReadinessPlan(readiness('draft', 'ip_unpublished', 'image_missing', 'kc_required'));
      expect(plan.next?.code).toBe('image_missing');
      expect(plan.others.map((item) => item.code)).toEqual(['kc_required', 'ip_unpublished']);
      expect(plan.publish).toBeNull();
    });

    it('막는 항목이 없으면 공개가 주 행동이고, 공개는 되지만 고객이 사지 못하는 항목이면 보조다', () => {
      expect(goodReadinessPlan(readiness('draft'))).toEqual({ next: null, others: [], publish: 'primary' });
      const soft = goodReadinessPlan(readiness('draft', 'stock_unavailable'));
      expect(soft.next?.code).toBe('stock_unavailable');
      expect(soft.publish).toBe('secondary');
    });

    it('판매 준비를 읽지 못하면 판정을 추정하지 않는다', () => {
      expect(goodReadinessPlan(null)).toEqual({ next: null, others: [], publish: 'secondary' });
      expect(goodReadinessPlan(unknownGoodsReadiness())).toEqual({ next: null, others: [], publish: 'secondary' });
    });

    it('판매 설정 배지는 초안·보관만으로는 확인 필요가 아니다', () => {
      expect(goodSaleSettingsState(readiness('draft'))).toBe('ready');
      expect(goodSaleSettingsState(readiness('archived'))).toBe('ready');
      expect(goodSaleSettingsState(readiness('draft', 'payment_disabled'))).toBe('blocked');
      expect(goodSaleSettingsState({ ...readiness(), saleSettings: 'unknown' })).toBe('unknown');
    });

    it('다음 할 일 버튼은 항목마다 이름과 도착지가 있다', () => {
      for (const code of Object.keys(GOODS_READINESS_REASONS) as GoodsReadinessReasonCode[]) expect(goodReadinessAction(code)).toBeTruthy();
      expect(goodReadinessAction('kc_required')).toBe('KC 검토하기');
      expect(goodReadinessReasonAnchor(reason('kc_required'))).toBe('good-operation-kc');
      expect(goodReadinessReasonAnchor(reason('image_missing'))).toBe('good-section-images');
      expect(goodReadinessReasonAnchor(reason('stopped'))).toBe('good-section-information');
    });
  });

  it('KC 검토를 되돌리는 변경을 DB 가드와 같은 기준으로 가린다', () => {
    const saved = { name: '상품', type: '키링', ipId: 'ip', noticeMaker: 'a', noticeOrigin: 'b', noticeMaterial: 'c', noticeSize: 'd' };
    const rows = [{ id: 'v1', name: '빨강', attributes: { 색상: '빨강', 크기: 'L' } }, { id: 'v2', name: '파랑', attributes: { 색상: '파랑', 크기: 'L' } }];
    const changed = (current: Partial<typeof saved>, next: typeof rows | { name: string; attributes: Record<string, string> }[] = rows) => goodKcContextChanged(saved, { ...saved, ...current }, rows, next);
    expect(changed({})).toBe(false);
    /* 앞뒤 공백과 옵션값 순서만 다르면 같은 입력이다. */
    expect(changed({ name: ' 상품 ' })).toBe(false);
    expect(changed({}, [{ ...rows[0], attributes: { 크기: 'L', 색상: '빨강' } }, rows[1]])).toBe(false);
    expect(changed({ name: '바꾼 상품' })).toBe(true);
    expect(changed({ noticeSize: '다른 크기' })).toBe(true);
    expect(changed({}, [{ ...rows[0], name: '바꾼 옵션' }, rows[1]])).toBe(true);
    expect(changed({}, [rows[0]])).toBe(true);
    expect(changed({}, [...rows, { name: '새 옵션', attributes: {} }])).toBe(true);
  });

  it('대표 카테고리에서 상품 유형을 제안하고 맞는 유형이 없으면 제안하지 않는다', () => {
    expect(goodTypeSuggestion(['문구', '아크릴 키링'])).toBe('키링');
    expect(goodTypeSuggestion(['봉제', '미니인형'])).toBe('인형');
    expect(goodTypeSuggestion(['지류', '스티커·엽서'])).toBe('문구');
    expect(goodTypeSuggestion(['리빙', '컵·텀블러'])).toBeNull();
    expect(goodTypeSuggestion([])).toBeNull();
  });
});
