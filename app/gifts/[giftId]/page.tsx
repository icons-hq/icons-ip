import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { GiftDetail } from '@/components/screens/gifts/GiftDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadGiftClaimContext } from '@/lib/gift-claims.server';
import { loadGift } from '@/lib/gifts.server';
import { loadMyOrderReturnPickup } from '@/lib/orders/return-pickup.server';
import { NO_RETURN_PICKUP } from '@/lib/orders/return-pickup';
import { loadMyCoupons } from '@/lib/coupons.server';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { isUuid } from '@/lib/uuid';
export const metadata: Metadata = { title: '선물 상세 — ICONS' };
export default async function Page({ params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await params; if (!isUuid(giftId)) notFound();
  const auth = await getCurrentAuthState(); if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/gifts/${giftId}`)}`);
  const gift = await loadGift(giftId); if (!gift) notFound();
  const coupons = gift.party === 'sender' && gift.state === 'accepted' ? await loadMyCoupons() : [];
  const claimContext = gift.order ? await loadGiftClaimContext(giftId, auth.user.id) : null;
  const carriers = await getShippingCarrierRegistry();
  /* 방문 회수 안내 문장(T13b)의 근거 — DB가 받는 분에게만 값을 돌려주고 보낸 분은 0이다. 스위치가 꺼져 있으면 0. */
  const returnPickup = gift.order && claimContext?.claim?.stage === 'collecting' ? await loadMyOrderReturnPickup(gift.order.id) : NO_RETURN_PICKUP;
  return <GiftDetail actorId={auth.user.id} initialGift={gift} coupons={coupons} initialClaimContext={claimContext} carriers={carriers} returnPickup={returnPickup} />;
}
