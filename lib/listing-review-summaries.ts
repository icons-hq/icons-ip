/* 남은 상품 카드 소비자의 별점 배선 (LFS 패리티 2차 L4b · CL-02).
 *
 * PDP 선반·캠페인 랜딩·쇼핑스토리의 상품 카드도 목록 카드처럼 "리뷰가 있으면" 별점을 단다. 숫자는 L4 가 만든
 * `public.get_goods_review_summaries`(굿즈 상세와 같은 묶음 그룹 범위·공개 리뷰만)에서 온다. 표면마다 카드 수만큼
 * 부르지 않고 그 표면의 굿즈 ID 를 한 번에 넘긴다(N+1 금지). 서버 로더는 `lib/listing-review-summaries.server.ts`,
 * 브라우저에서 굿즈를 받아 오는 선반은 `components/shop/useListingReviewSummaries.ts` 가 같은 규칙으로 묻는다.
 *
 * RPC 는 ID 하나라도 형식이 어긋나면 묶음 전체를 거절한다(invalid_goods_review_summary_goods). 그래서 보내기 전에
 * 같은 형식만 남긴다 — 굿즈 ID 는 이미 그 형식(소문자·숫자·하이픈 64자)이라 실제로 빠지는 것은 캠페인 본문처럼
 * 형식 검사 없이 저장된 참조 문자열뿐이고, 그런 값은 어차피 공개 굿즈가 아니다. */

import type { PublicGoodOtherCompositions } from './good-other-compositions';
import type { PublicGoodRelations } from './good-relations';
import type { PublicDetailPresentation } from './product-detail-presentation';

/** RPC 한 번에 받는 굿즈 수(`get_goods_review_summaries` 의 1~500 경계). */
export const LISTING_REVIEW_SUMMARY_BATCH = 500;

const REVIEW_SUMMARY_GOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 별점을 물을 굿즈 ID — 중복과 RPC 형식 밖의 값을 빼고 처음 나온 순서를 지킨다. */
export function listingReviewSummaryIds(goodIds: Iterable<unknown>): string[] {
  const ids = new Set<string>();
  for (const id of goodIds) {
    if (typeof id === 'string' && REVIEW_SUMMARY_GOOD_ID.test(id)) ids.add(id);
  }
  return [...ids];
}

/** RPC 경계(500개)로 나눈다. 빈 목록은 빈 배열 — 부를 일이 없다. */
export function listingReviewSummaryBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += LISTING_REVIEW_SUMMARY_BATCH) {
    batches.push(ids.slice(index, index + LISTING_REVIEW_SUMMARY_BATCH));
  }
  return batches;
}

/**
 * 서버가 그리는 PDP 선반 세 가지(연관 굿즈·다른 구성·자동 추천)의 카드 굿즈 ID. 자동 추천은 수동 편성 우선·최소 개수
 * 규칙으로 일부가 화면에서 빠질 수 있지만, 그 판정은 화면 몫이라 여기서는 넉넉히 모은다(한 번의 묶음 조회).
 */
export function pdpShelfGoodIds(shelves: {
  relatedGoods?: PublicGoodRelations | null;
  otherCompositions?: PublicGoodOtherCompositions | null;
  presentation?: Pick<PublicDetailPresentation, 'recommendations'> | null;
}): string[] {
  return listingReviewSummaryIds([
    ...(shelves.relatedGoods?.groups ?? []).flatMap((group) => group.goods.map((good) => good.id)),
    ...(shelves.otherCompositions?.groups ?? []).flatMap((group) => group.goods.map(({ good }) => good.id)),
    ...Object.values(shelves.presentation?.recommendations ?? {}).flatMap((goods) => goods.map((good) => good.id)),
  ]);
}
