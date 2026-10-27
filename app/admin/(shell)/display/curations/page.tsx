import { randomUUID } from 'node:crypto';
import { CurationScreen } from '@/components/admin/screens/CurationScreen';
import { loadAdminCurationTargets } from '@/lib/admin/curation-targets.server';
import { getAdminCurations } from '@/lib/admin/curations.server';
import { getAdminHomeLayout } from '@/lib/admin/home-layout.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { resolveHomeGoodsCards, resolveHomeLatestGoodsCards } from '@/lib/home-catalog';
import { getShellNotices } from '@/lib/notice-strip.server';
import { applicableShellNotices } from '@/lib/shell-notices';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { loadHomeProductRankings } from '@/lib/home-ranking.server';

export default async function AdminDisplayCurationsPage() {
  await requireAdminScreenAccess('/admin/display/curations');

  const [curations, records, home, notices, cardRewardsEnabled, homeLayout] = await Promise.all([
    getAdminCurations(),
    loadAdminCurationTargets(),
    /* 리뷰 BEST 선정·정렬·표시가 그룹 범위 요약(reviewSummary)을 쓰므로 공개 홈(app/page.tsx)과 같은 옵션으로 읽는다 —
       없으면 '현재 공개 홈' 미리보기·노출 가능 수·상품 선택기가 굿즈 단위로 폴백해 공개 홈과 선정이 엇갈린다. */
    getHomeSnapshot({ includeReviewSummaries: true }),
    getShellNotices(),
    readCardRewardsEnabled(),
    getAdminHomeLayout(),
  ]);
  const productRankings = await loadHomeProductRankings(home.catalog.goods);
  /* '현재 공개 홈' 미리보기는 홈 화면 유형에 실제로 보일 공지를 쓴다 — 무작위 스트립은 첫 후보로 고정해 보여 준다. */
  const homeNotices = applicableShellNotices(notices, '/', { cardRewardsEnabled, communityEnabled: COMMUNITY_ENABLED });

  return (
    <CurationScreen
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      eventOptions={[...records.events]}
      goodOptions={[...records.goods]}
      ipOptions={[...records.ips]}
      operationId={randomUUID()}
      homeLayout={homeLayout}
      homeLayoutOperationId={randomUUID()}
      preview={{
        curation: home.curation,
        noticeStrip: homeNotices.strips[0] ?? null,
        noticeBar: homeNotices.bars[0] ?? null,
        goods: resolveHomeGoodsCards(home.catalog, home.catalog.goods.map((good) => good.id), home.catalog.goods.length),
        latestGoods: resolveHomeLatestGoodsCards(home.catalog, 10),
        productRankings,
        cardRewardsEnabled,
      }}
      records={curations}
    />
  );
}
