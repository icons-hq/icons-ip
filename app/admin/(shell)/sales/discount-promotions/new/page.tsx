import { notFound } from 'next/navigation';
import { DiscountPromotionEditorScreen } from '@/components/admin/screens/DiscountPromotionEditorScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadDiscountPromotionTargetOptions } from '@/lib/admin/discount-promotions.server';
import { DISCOUNT_PROMOTION_NAME_MAX, DISCOUNT_PROMOTIONS_PATH, validCampaignId, validIpId } from '@/lib/admin/discount-promotions';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/server';

const defaultName = (title: string) => [...`${title} 할인`].slice(0, DISCOUNT_PROMOTION_NAME_MAX).join('').trim();

/** 새 할인 프로모션. `?campaign=` 은 캠페인 편집기의 '이 기획전 할인 만들기', `?ip=` 는 IP로 거른 상품 목록에서 넘어온다. */
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
  return <DiscountPromotionEditorScreen identity={sessionId ? { actorId: auth.user.id, sessionId } : null} initial={initial} options={options} />;
}
