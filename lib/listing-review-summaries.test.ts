import { describe, expect, it } from 'vitest';
import type { Good } from './data';
import {
  LISTING_REVIEW_SUMMARY_BATCH,
  listingReviewSummaryBatches,
  listingReviewSummaryIds,
  pdpShelfGoodIds,
} from './listing-review-summaries';

const good = (id: string): Good => ({ id, name: id, ip: 'ip', type: '문구', price: 1000, badge: null, img: '', stock: 'ok', stockQty: 1 });

describe('listingReviewSummaryIds', () => {
  it('RPC 형식 밖 값·중복을 빼고 처음 나온 순서를 지킨다', () => {
    expect(listingReviewSummaryIds(['g2', 'g1', 'g2', ' g3', 'G4_x', '', 'a'.repeat(65), 'a'.repeat(64), null, 7])).toEqual(['g2', 'g1', 'G4_x', 'a'.repeat(64)]);
  });

  /* 형식이 어긋난 ID 하나가 묶음 전체를 invalid_goods_review_summary_goods 로 떨어뜨리지 않게 미리 뺀다. */
  it('공백·슬래시·한글처럼 RPC 가 거절할 문자를 담은 값은 보내지 않는다', () => {
    expect(listingReviewSummaryIds(['good-1', 'good 2', 'good/3', '굿즈', 'good.4'])).toEqual(['good-1']);
  });
});

describe('listingReviewSummaryBatches', () => {
  it('500개 경계로 나누고 빈 목록은 부르지 않는다', () => {
    const ids = Array.from({ length: LISTING_REVIEW_SUMMARY_BATCH * 2 + 1 }, (_, index) => `g${index}`);
    const batches = listingReviewSummaryBatches(ids);

    expect(LISTING_REVIEW_SUMMARY_BATCH).toBe(500);
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 1]);
    expect(batches.flat()).toEqual(ids);
    expect(listingReviewSummaryBatches([])).toEqual([]);
  });
});

describe('pdpShelfGoodIds', () => {
  it('연관 굿즈·다른 구성·자동 추천 카드의 굿즈를 한 번의 묶음으로 모은다', () => {
    const ids = pdpShelfGoodIds({
      relatedGoods: { nextChangeAt: null, groups: [{ id: 'r', kind: 'similar', title: '유사', goods: [good('a'), good('b')], allGoods: [good('current'), good('a'), good('b')] }] },
      otherCompositions: { nextChangeAt: null, groups: [{ id: 'o', title: '다른 구성', goods: [{ good: good('b'), compositionLabel: null }, { good: good('c'), compositionLabel: '세트' }] }] },
      presentation: { recommendations: { similar: [good('d')], together: [], categoryPopular: [good('a')], storePopular: [good('e')] } },
    });

    /* 시각 자료용 allGoods(현재 굿즈 포함)는 카드가 아니라 묻지 않는다. 같은 굿즈는 한 번만. */
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('선반이 비었거나 읽기에 실패한 상세는 빈 목록이다', () => {
    expect(pdpShelfGoodIds({})).toEqual([]);
    expect(pdpShelfGoodIds({ relatedGoods: null, otherCompositions: { groups: [], nextChangeAt: null, unavailable: true }, presentation: null })).toEqual([]);
  });
});
