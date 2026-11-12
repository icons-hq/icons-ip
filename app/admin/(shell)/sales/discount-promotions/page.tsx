import { DiscountPromotionListScreen } from '@/components/admin/screens/DiscountPromotionListScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadDiscountPromotionList, loadDiscountPromotionTargetOptions } from '@/lib/admin/discount-promotions.server';
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
  /* 기획전으로 거른 목록은 내부 ID 대신 기획전 제목으로 알린다(QA1 MD). 목록에 그 기획전 행이 없으면 대상 목록에서 찾고, 못 찾으면 ID로 둔다. */
  const campaignTitle = !campaign ? null
    : data.rows.find(row => row.target.kind === 'campaign' && row.target.id === campaign && row.target.label)?.target.label
      ?? (await loadDiscountPromotionTargetOptions().catch(() => null))?.campaigns.find(item => item.id === campaign)?.title ?? null;
  return <DiscountPromotionListScreen campaign={campaign} campaignTitle={campaignTitle} canManage={hasAdminCapability(auth, 'catalog.manage')} data={data} page={rawPage} />;
}
