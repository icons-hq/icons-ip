/* 목록 카드 별점 요약 (LFS 패리티 2차 L4 · CL-02).
 *
 * 카탈로그 스냅샷이 공개 굿즈 ID 를 한 번에 넘겨 받은 굿즈별 공개 리뷰 수·평균이다
 * (`public.get_goods_review_summaries`, 서버 로더 `lib/goods-review-summary.server.ts`).
 * 숫자는 굿즈 상세의 평점 요약과 같은 그룹 범위·공개 조건에서 나온다. 리뷰 0건 굿즈는 값이 없고
 * 카드는 별점을 숨긴다 — "0.0 (0)" 같은 빈 별점을 그리지 않는다. */

export interface GoodsReviewSummary {
  /** 공개 리뷰 수(1 이상). */
  count: number;
  /** 공개 리뷰 평균(1~5, 소수 둘째 자리). */
  average: number;
}

export type GoodsReviewSummaries = Readonly<Record<string, GoodsReviewSummary>>;

/**
 * RPC 응답을 검증해 굿즈 ID → 요약으로 바꾼다. 요청하지 않은 ID·범위 밖 값·형식이 다른 행은 버린다 —
 * 별점은 장식이라 이상한 행 하나 때문에 목록이 실패하면 안 되지만, 틀린 숫자를 보여서도 안 된다.
 */
export function parseGoodsReviewSummaries(rows: unknown, allowedIds: ReadonlySet<string>): Record<string, GoodsReviewSummary> {
  const output: Record<string, GoodsReviewSummary> = {};
  if (!Array.isArray(rows)) return output;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { goodId, reviewCount, ratingAverage } = row as Record<string, unknown>;
    const count = Number(reviewCount);
    const average = Number(ratingAverage);
    if (typeof goodId !== 'string' || !allowedIds.has(goodId) || Object.hasOwn(output, goodId)) continue;
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(average) || average < 1 || average > 5) continue;
    output[goodId] = { count, average };
  }
  return output;
}

/** 목록에 보이는 굿즈 몫만 골라 화면으로 넘긴다 — 카탈로그 전체 요약을 클라이언트에 싣지 않는다. */
export function pickGoodsReviewSummaries(
  summaries: GoodsReviewSummaries | undefined,
  goodIds: readonly string[],
): Record<string, GoodsReviewSummary> {
  const picked: Record<string, GoodsReviewSummary> = {};
  if (!summaries) return picked;
  for (const id of goodIds) {
    const summary = summaries[id];
    if (summary) picked[id] = summary;
  }
  return picked;
}

/** 별 다섯 칸의 채움 개수 — 상세 별점과 같은 반올림이다. */
export function reviewStarCount(average: number): number {
  return Math.max(0, Math.min(5, Math.round(average)));
}

/** 스크린리더가 읽는 문장. 별 문자를 그대로 읽히면 "검은 별 검은 별…"이 된다. */
export function reviewSummaryLabel(summary: GoodsReviewSummary): string {
  return `평점 5점 만점에 ${summary.average.toFixed(1)}점, 리뷰 ${summary.count.toLocaleString('ko-KR')}개`;
}
