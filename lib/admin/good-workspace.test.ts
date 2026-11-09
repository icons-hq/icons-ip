import { describe, expect, it } from 'vitest';
import { GOOD_EDITOR_CARDS, GOOD_EDITOR_SECTIONS, goodFieldSection, goodPublishRequirements, goodRemainingByCard, goodTypeSuggestion, orderedGoodErrors } from './good-workspace';

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

  it('대표 카테고리에서 상품 유형을 제안하고 맞는 유형이 없으면 제안하지 않는다', () => {
    expect(goodTypeSuggestion(['문구', '아크릴 키링'])).toBe('키링');
    expect(goodTypeSuggestion(['봉제', '미니인형'])).toBe('인형');
    expect(goodTypeSuggestion(['지류', '스티커·엽서'])).toBe('문구');
    expect(goodTypeSuggestion(['리빙', '컵·텀블러'])).toBeNull();
    expect(goodTypeSuggestion([])).toBeNull();
  });
});
