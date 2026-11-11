import { notFound } from 'next/navigation';
import { DiscountPromotionDetailScreen } from '@/components/admin/screens/DiscountPromotionDetailScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadDiscountPromotion } from '@/lib/admin/discount-promotions.server';
import { DISCOUNT_PROMOTIONS_PATH } from '@/lib/admin/discount-promotions';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export default async function DiscountPromotionDetailPage({ params }: { params: Promise<{ promotionId: string }> }) {
  const { promotionId } = await params;
  const auth = await requireAdminScreenAccess(`${DISCOUNT_PROMOTIONS_PATH}/${encodeURIComponent(promotionId)}`);
  if (!isUuid(promotionId)) notFound();
  const client = await createClient();
  const [promotion, currentSession] = await Promise.all([loadDiscountPromotion(promotionId.toLowerCase()), client.auth.getSession()]);
  if (!promotion) notFound();
  const sessionId = currentSession.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(currentSession.data.session.access_token) : null;
  return <DiscountPromotionDetailScreen canManage={hasAdminCapability(auth, 'catalog.manage')} identity={sessionId ? { actorId: auth.user.id, sessionId } : null} promotion={promotion} />;
}
