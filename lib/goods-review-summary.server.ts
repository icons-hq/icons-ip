import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseGoodsReviewSummaries, type GoodsReviewSummary } from './goods-review-summary';

/* 목록 카드 별점 배치 로더 (LFS 패리티 2차 L4 · CL-02).
 * 카탈로그 스냅샷이 공개 굿즈 ID 전체를 넘긴다. RPC 는 한 번에 500개까지 받으므로 나눠 병렬로 부른다 —
 * 카드 수만큼 부르지 않는다(N+1 금지). 실패한 묶음은 별점을 숨길 뿐 목록을 실패시키지 않는다. */
export const GOODS_REVIEW_SUMMARY_BATCH = 500;

export async function loadGoodsReviewSummaries(
  client: Pick<SupabaseClient, 'rpc'>,
  ids: readonly string[],
): Promise<Record<string, GoodsReviewSummary>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += GOODS_REVIEW_SUMMARY_BATCH) {
    batches.push(unique.slice(index, index + GOODS_REVIEW_SUMMARY_BATCH));
  }
  const results = await Promise.all(batches.map((batch) => client.rpc('get_goods_review_summaries', { p_good_ids: batch })));
  const allowed = new Set(unique);
  const summaries: Record<string, GoodsReviewSummary> = {};
  for (const result of results) {
    if (result.error) continue;
    Object.assign(summaries, parseGoodsReviewSummaries(result.data, allowed));
  }
  return summaries;
}
