import { randomUUID } from 'node:crypto';
import { CurationScreen } from '@/components/admin/screens/CurationScreen';
import { loadAdminCurationTargets } from '@/lib/admin/curation-targets.server';
import { getAdminCurations } from '@/lib/admin/curations.server';
import { getAdminHomeLayout } from '@/lib/admin/home-layout.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { resolveHomeGoodsCards, resolveHomeLatestGoodsCards } from '@/lib/home-catalog';
import { getActiveNoticeStrip } from '@/lib/notice-strip.server';
import { loadHomeProductRankings } from '@/lib/home-ranking.server';

export default async function AdminDisplayCurationsPage() {
  await requireAdminScreenAccess('/admin/display/curations');

  const [curations, records, home, noticeStrip, cardRewardsEnabled, homeLayout] = await Promise.all([
    getAdminCurations(),
    loadAdminCurationTargets(),
    getHomeSnapshot(),
    getActiveNoticeStrip(),
    readCardRewardsEnabled(),
    getAdminHomeLayout(),
  ]);
  const productRankings = await loadHomeProductRankings(home.catalog.goods);

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
        noticeStrip,
        goods: resolveHomeGoodsCards(home.catalog, home.catalog.goods.map((good) => good.id), home.catalog.goods.length),
        latestGoods: resolveHomeLatestGoodsCards(home.catalog, 10),
        productRankings,
        cardRewardsEnabled,
      }}
      records={curations}
    />
  );
}
