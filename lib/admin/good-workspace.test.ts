import { describe, expect, it } from 'vitest';
import { GOOD_EDITOR_CARDS, GOOD_EDITOR_SECTIONS, GOOD_PUBLISHED_LOCKS, changedGoodLockedFields, goodCurrentCard, goodErrorsByCard, goodFieldSection, goodKcContextChanged, goodPublishRequirements, goodReadinessAction, goodReadinessPlan, goodReadinessReasonAnchor, goodRemainingByCard, goodSaleSettingsState, goodTypeFromCategory, goodTypeSuggestion, GOOD_TYPE_CATEGORY_MESSAGES, orderedGoodErrors } from './good-workspace';
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
    /* 판매가 → 재고수량·옵션 → 판매기간 → 예약판매 → 구매 제한(1027T-023), KC는 고시 바로 뒤. */
    expect(orderedGoodErrors({ workspacePreorders: 'p', maxOrderQty: 'l', variants: 'v', price: 'a', originId: 'o', workspaceKc: 'k', noticeMaker: 'n', saleStartsAt: 's' }).map(([field]) => field))
      .toEqual(['price', 'variants', 'saleStartsAt', 'workspacePreorders', 'maxOrderQty', 'noticeMaker', 'workspaceKc', 'originId']);
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

  it('고른 카테고리의 필수 상품속성도 기본 정보에서 남은 칸으로 센다', () => {
    const requirements = goodPublishRequirements({ values, regularPrice: 12900, hasStock: true, kcDone: true, missingAttributes: ['핏'] });
    expect(requirements.filter((item) => !item.done)).toEqual([expect.objectContaining({ key: 'attribute:핏', card: 'basic', anchor: 'good-section-attributes', field: 'productAttributes' })]);
    expect(goodRemainingByCard(requirements).basic).toBe(1);
  });

  it('저장에 실패한 칸을 카드별로 세고 카드에 속하지 않는 오류는 세지 않는다', () => {
    expect(goodErrorsByCard({})).toEqual({});
    expect(goodErrorsByCard({ name: 'n', ipId: undefined, categoryId: 'c', regularPrice: 'p', maxOrderQty: 'l', originId: 'o', badge: 'b', form: '폼 오류' })).toEqual({ basic: 2, sales: 2, delivery: 1, additional: 1 });
    /* 등록 화면 KC는 고시 카드, 예약판매는 판매 정보 카드 안의 입력이다(1027T-023). */
    expect(goodErrorsByCard({ workspaceKc: 'k', noticeMaker: 'n', workspacePreorders: 'p' })).toEqual({ notice: 2, sales: 1 });
  });

  /* TKT-094 — 공개 중 잠금 칸의 저장 전 검사. 이 검사가 막으면 서버에 보내지 않는다(GoodEditor.capture.client.test). */
  it('공개 중 잠긴 7칸이 바뀌면 칸마다 초안 전환 안내를 돌려주고, 앞뒤 공백과 잠기지 않은 칸은 무시한다', () => {
    const saved = { name: '상품', type: '키링', ipId: 'ip', noticeMaker: 'a', noticeOrigin: 'b', noticeMaterial: 'c', noticeSize: 'd', noticeMadeOn: '2026-11', price: '1000' };
    expect(changedGoodLockedFields(saved, { ...saved })).toEqual([]);
    expect(changedGoodLockedFields(saved, { ...saved, name: ' 상품 ', noticeMadeOn: '2026-12', price: '2000' })).toEqual([]);
    expect(changedGoodLockedFields(saved, { ...saved, name: '바꾼 상품', noticeOrigin: '일본' })).toEqual([
      ['name', '상품명 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.'],
      ['noticeOrigin', '제조국 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.'],
    ]);
    /* 빠진 칸은 빈 값으로 비교한다 — 저장값이 있는데 제출에서 사라지면 바뀐 것이다. */
    const withoutIp: Record<string, string> = { ...saved };
    delete withoutIp.ipId;
    expect(changedGoodLockedFields(saved, withoutIp).map(([field]) => field)).toEqual(['ipId']);
    expect(Object.keys(GOOD_PUBLISHED_LOCKS)).toEqual(['name', 'type', 'ipId', 'noticeMaker', 'noticeOrigin', 'noticeMaterial', 'noticeSize']);
  });

  it('지금 보는 카드는 읽는 선을 지난 마지막 카드다', () => {
    const boxes = [{ key: 'basic', top: 200, bottom: 700 }, { key: 'sales', top: 716, bottom: 1400 }, { key: 'additional', top: 1416, bottom: 1472 }] as const;
    /* 첫 카드에 닿기 전에도 첫 카드를 표시한다. */
    expect(goodCurrentCard(boxes, 100)).toBe('basic');
    expect(goodCurrentCard(boxes, 300)).toBe('basic');
    expect(goodCurrentCard(boxes, 708)).toBe('basic');
    expect(goodCurrentCard(boxes, 716)).toBe('sales');
    expect(goodCurrentCard(boxes, 1450)).toBe('additional');
    /* 마지막 카드를 다 지나면(이어서 설정·미리보기) 어느 단계도 아니다. */
    expect(goodCurrentCard(boxes, 1500)).toBeNull();
    expect(goodCurrentCard([], 100)).toBeNull();
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

/* SHEET-003(ADR-0037): 상품 유형 = 대표 카테고리(없으면 가까운 상위)의 연결값. 화면 판정이고 저장·공개 판정은 서버가 한다. */
describe('상품 유형을 대표 카테고리에서 파생', () => {
  const categories = [
    { id: 'root', parentId: null, goodType: '피규어' },
    { id: 'leaf', parentId: 'root', goodType: null },
    { id: 'doll', parentId: 'root', goodType: '인형' },
    { id: 'none', parentId: null, goodType: null },
  ];
  it('초안은 연결값을 싣고, 연결이 없으면 저장된 값을 그대로 둔다(공개는 막힌다)', () => {
    expect(goodTypeFromCategory({ categories, categoryId: 'leaf', initialCategoryId: 'leaf', storedType: '문구', published: false }))
      .toEqual({ category: { type: '피규어', categoryId: 'root', inherited: true }, submitted: '피규어', categoryChangeProblem: null, publishedMismatch: null });
    expect(goodTypeFromCategory({ categories, categoryId: 'none', initialCategoryId: 'none', storedType: '문구', published: false }).submitted).toBe('문구');
    expect(goodTypeFromCategory({ categories, categoryId: '', initialCategoryId: '', storedType: '', published: false }).submitted).toBe('');
  });
  it('공개 중이면 저장된 유형을 유지하고, 유형이 바뀌는 카테고리 변경은 막고, 그대로면 경고만 한다', () => {
    const published = { categories, initialCategoryId: 'leaf', storedType: '피규어', published: true };
    expect(goodTypeFromCategory({ ...published, categoryId: 'leaf' })).toMatchObject({ submitted: '피규어', categoryChangeProblem: null, publishedMismatch: null });
    expect(goodTypeFromCategory({ ...published, categoryId: 'root' })).toMatchObject({ submitted: '피규어', categoryChangeProblem: null });
    expect(goodTypeFromCategory({ ...published, categoryId: 'doll' }).categoryChangeProblem).toBe(GOOD_TYPE_CATEGORY_MESSAGES.locked);
    expect(goodTypeFromCategory({ ...published, categoryId: 'none' }).categoryChangeProblem).toBe(GOOD_TYPE_CATEGORY_MESSAGES.required);
    expect(goodTypeFromCategory({ ...published, categoryId: '' }).categoryChangeProblem).toBe(GOOD_TYPE_CATEGORY_MESSAGES.required);
    expect(goodTypeFromCategory({ ...published, initialCategoryId: 'doll', categoryId: 'doll' })).toMatchObject({ submitted: '피규어', categoryChangeProblem: null, publishedMismatch: 'different' });
    expect(goodTypeFromCategory({ ...published, initialCategoryId: 'none', categoryId: 'none' }).publishedMismatch).toBe('missing');
    expect(goodTypeFromCategory({ ...published, initialCategoryId: '', categoryId: '' }).publishedMismatch).toBe('no-category');
  });
  it('판매 준비 사유는 카테고리 칸으로 안내하고, 초안의 유형 불일치는 공개를 막는 항목이다', () => {
    expect(goodReadinessReasonAnchor({ code: 'type_missing', target: 'basic' })).toBe('good-section-category');
    expect(goodReadinessReasonAnchor({ code: 'type_category_mismatch', target: 'basic' })).toBe('good-section-category');
    expect(goodReadinessReasonAnchor({ code: 'type_no_category', target: 'basic' })).toBe('good-section-category');
    expect(GOODS_READINESS_REASONS.type_no_category.label).toBe('대표 카테고리 없음');
    expect(GOODS_READINESS_REASONS.type_no_category.detail).toContain('대표로 고르면 공개를 유지한 채');
    expect(goodReadinessAction('type_missing')).toBe('카테고리 상품 유형 확인하기');
    expect(GOODS_READINESS_REASONS.type_missing.label).toBe('카테고리에 상품 유형 연결 필요');
    const reason = (code: GoodsReadinessReasonCode) => ({ code, ...GOODS_READINESS_REASONS[code], kind: 'blocking' as const });
    const readiness: AdminGoodsReadiness = { ...unknownGoodsReadiness(), state: 'blocked', publication: 'draft', reasons: [reason('draft'), reason('type_category_mismatch')] };
    expect(goodReadinessPlan(readiness).publish).toBeNull();
  });
});
