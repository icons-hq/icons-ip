'use client';

import { useEffect, useRef, useState } from 'react';
import { parseGoodsReviewSummaries, type GoodsReviewSummary } from '@/lib/goods-review-summary';
import { listingReviewSummaryBatches, listingReviewSummaryIds } from '@/lib/listing-review-summaries';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

const NO_SUMMARIES: Readonly<Record<string, GoodsReviewSummary>> = {};

/*
 * 브라우저에서 굿즈를 받아 오는 선반의 카드 별점 (LFS 패리티 2차 L4b · CL-02).
 *
 * 관심 굿즈 모아보기·배송비 절약 굿즈는 굿즈를 서버 액션으로 받아 오므로 서버 렌더 때는 어떤 굿즈가 보일지 모른다.
 * 받아 온 굿즈 ID 를 한 번에 L4 의 공개 읽기 RPC(`get_goods_review_summaries`, anon·authenticated 실행)로 묻는다 —
 * 기존 액션의 응답 모양은 바꾸지 않는다. 숫자는 굿즈 상세·목록 카드와 같은 그룹 범위다.
 *
 * 한 번 물은 굿즈는 다시 묻지 않는다: 탭 전환·수량 변경으로 목록이 바뀌어도 이미 받은 별점이 꺼졌다 켜지지 않고,
 * 새로 보인 굿즈만 묻는다. 실패한 묶음은 별점만 숨기고 다음에 그 굿즈가 다시 보이면 다시 묻는다.
 * 별점은 회원과 무관한 공개 값이라 계정이 바뀌어도 비울 것이 없다.
 */
export function useListingReviewSummaries(goodIds: readonly string[]): Readonly<Record<string, GoodsReviewSummary>> {
  const key = listingReviewSummaryIds(goodIds).sort().join(',');
  const [summaries, setSummaries] = useState(NO_SUMMARIES);
  /* 응답을 기다리는 중이거나 이미 받은 굿즈 — 같은 굿즈를 겹쳐 묻지 않는다. */
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!key || !getSupabaseConfig().isConfigured) return;
    const missing = key.split(',').filter((id) => !requested.current.has(id));
    if (!missing.length) return;
    for (const id of missing) requested.current.add(id);
    const client = createClient();
    for (const batch of listingReviewSummaryBatches(missing)) {
      const release = () => {
        for (const id of batch) requested.current.delete(id);
      };
      void client.rpc('get_goods_review_summaries', { p_good_ids: batch }).then(({ data, error }) => {
        if (error) {
          release();
          return;
        }
        const found = parseGoodsReviewSummaries(data, new Set(batch));
        if (Object.keys(found).length) setSummaries((current) => ({ ...current, ...found }));
      }, release);
    }
  }, [key]);

  return summaries;
}
