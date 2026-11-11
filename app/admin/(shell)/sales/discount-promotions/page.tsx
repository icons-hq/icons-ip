import { DiscountPromotionListScreen } from '@/components/admin/screens/DiscountPromotionListScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadDiscountPromotionList } from '@/lib/admin/discount-promotions.server';
import { DISCOUNT_PROMOTIONS_PATH, validCampaignId } from '@/lib/admin/discount-promotions';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminDiscountPromotionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트를 로더보다 먼저 부른다(layout과 page는 병렬로 렌더된다). */
  const auth = await requireAdminScreenAccess(DISCOUNT_PROMOTIONS_PATH);
  const params = await searchParams;
  const campaign = validCampaignId(params.campaign) ? params.campaign : null;
  const rawPage = typeof params.page === 'string' && /^[1-9][0-9]{0,4}$/.test(params.page) ? Number(params.page) : 1;
  const data = await loadDiscountPromotionList({ campaign, page: rawPage });
  return <DiscountPromotionListScreen campaign={campaign} canManage={hasAdminCapability(auth, 'catalog.manage')} data={data} page={rawPage} />;
}
