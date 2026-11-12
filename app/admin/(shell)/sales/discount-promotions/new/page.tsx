import { notFound } from 'next/navigation';
import { DiscountPromotionEditorScreen } from '@/components/admin/screens/DiscountPromotionEditorScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadDiscountPromotionTargetOptions } from '@/lib/admin/discount-promotions.server';
import { DISCOUNT_PROMOTION_NAME_MAX, DISCOUNT_PROMOTIONS_PATH, discountPromotionListHref, validCampaignId, validIpId } from '@/lib/admin/discount-promotions';
import { adminCampaignHref } from '@/lib/admin/campaigns';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/server';

const defaultName = (title: string) => [...`${title} 할인`].slice(0, DISCOUNT_PROMOTION_NAME_MAX).join('').trim();

/**
 * 새 할인 프로모션. `?campaign=` 은 캠페인 편집기의 '이 기획전 할인 만들기'(`&from=campaign`)나 기획전으로 거른 프로모션 목록,
 * `?ip=` 는 IP로 거른 상품 목록에서 넘어온다. 취소·돌아가기는 캠페인 편집에서 왔으면 그 캠페인 편집으로, 아니면 프로모션 목록으로 간다(QA1 MD).
 */
export default async function NewDiscountPromotionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(`${DISCOUNT_PROMOTIONS_PATH}/new`);
  if (!hasAdminCapability(auth, 'catalog.manage')) notFound();
  const params = await searchParams;
  const client = await createClient();
  const [options, currentSession] = await Promise.all([loadDiscountPromotionTargetOptions(), client.auth.getSession()]);
  const sessionId = currentSession.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(currentSession.data.session.access_token) : null;
  const campaign = validCampaignId(params.campaign) ? options.campaigns.find(item => item.id === params.campaign) : undefined;
  const ip = !campaign && validIpId(params.ip) ? options.ips.find(item => item.id === params.ip) : undefined;
  const initial = campaign ? { kind: 'campaign' as const, campaignId: campaign.id, ipId: null, name: defaultName(campaign.title) }
    : ip ? { kind: 'ip' as const, campaignId: null, ipId: ip.id, name: defaultName(ip.title) }
    : { kind: 'campaign' as const, campaignId: null, ipId: null, name: '' };
  const returnTo = campaign && params.from === 'campaign' ? { href: adminCampaignHref(campaign.id), label: '캠페인 편집으로' }
    : { href: discountPromotionListHref(campaign ? { campaign: campaign.id } : {}), label: '목록으로' };
  return <DiscountPromotionEditorScreen identity={sessionId ? { actorId: auth.user.id, sessionId } : null} initial={initial} options={options} returnTo={returnTo} />;
}
