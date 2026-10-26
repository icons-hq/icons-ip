import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoodsReviewSummary } from './goods-review-summary';
import { loadGoodsReviewSummaries } from './goods-review-summary.server';
import { listingReviewSummaryIds } from './listing-review-summaries';
import { getSupabaseConfig } from './supabase/config';
import { createClient } from './supabase/server';

/* 남은 상품 카드 소비자의 별점 서버 로더 (LFS 패리티 2차 L4b · CL-02).
 *
 * L4 의 배치 로더(`loadGoodsReviewSummaries` — 500개 묶음·병렬·검증)를 그대로 쓰고, 그 앞뒤에 이 표면들이 필요한
 * 두 가지만 더한다: RPC 형식 밖의 ID 를 미리 빼고(`listingReviewSummaryIds`), 무슨 일이 있어도 던지지 않는다.
 * 별점은 장식이다 — 상세·캠페인·스토리는 비로그인에게도 열린 공개 표면이라, 별점을 못 읽었다고 페이지가 500 이
 * 되면 안 된다. 읽지 못한 굿즈는 값이 없고 카드는 별점 줄을 그리지 않는다. */

/** 이미 만든 요청 클라이언트로 읽는다(캠페인·쇼핑스토리 로더처럼 같은 요청에서 다른 조회를 하는 곳). */
export async function readListingReviewSummaries(
  client: Pick<SupabaseClient, 'rpc'>,
  goodIds: Iterable<unknown>,
): Promise<Record<string, GoodsReviewSummary>> {
  const ids = listingReviewSummaryIds(goodIds);
  if (!ids.length) return {};
  try {
    return await loadGoodsReviewSummaries(client, ids);
  } catch {
    return {};
  }
}

/** 요청 클라이언트를 직접 만들어 읽는다(PDP 선반). Supabase 미설정(mock) 실행은 별점이 없다. */
export async function loadListingReviewSummaries(goodIds: Iterable<unknown>): Promise<Record<string, GoodsReviewSummary>> {
  const ids = listingReviewSummaryIds(goodIds);
  if (!ids.length || !getSupabaseConfig().isConfigured) return {};
  try {
    return await readListingReviewSummaries(await createClient(), ids);
  } catch {
    return {};
  }
}
