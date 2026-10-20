import { CampaignScreen } from '@/components/admin/screens/CampaignScreen';
import { getAdminCampaignConsoleData } from '@/lib/admin/campaigns.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { hasAdminCapability } from '@/lib/admin/access';

export default async function AdminDisplayCampaignsPage() {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 캠페인 조회를 막지 못한다.
   * draft 캠페인은 준비 중인 편성 그 자체라 새면 공개 전 라인업이 그대로 노출된다.
   */
  const auth = await requireAdminScreenAccess('/admin/display/campaigns');
  const canManageOffers = hasAdminCapability(auth, 'platform.manage');

  const [data, catalog] = await Promise.all([
    getAdminCampaignConsoleData({ includeOffers: canManageOffers }),
    canManageOffers ? getAdminCatalogRecords({ include: ['cardPools'] }) : Promise.resolve({ cardPools: [] }),
  ]);

  return (
    <CampaignScreen
      offers={data.offers}
      pools={catalog.cardPools}
      records={data.campaigns}
      canManageOffers={canManageOffers}
    />
  );
}
