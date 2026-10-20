import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { GiftDetail } from '@/components/screens/gifts/GiftDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadGiftClaimContext } from '@/lib/gift-claims.server';
import { loadGift } from '@/lib/gifts.server';
import { loadMyCoupons } from '@/lib/coupons.server';
import { isUuid } from '@/lib/uuid';
export const metadata: Metadata = { title: '선물 상세 — ICONS' };
export default async function Page({ params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await params; if (!isUuid(giftId)) notFound();
  const auth = await getCurrentAuthState(); if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/gifts/${giftId}`)}`);
  const gift = await loadGift(giftId); if (!gift) notFound();
  const coupons = gift.party === 'sender' && gift.state === 'accepted' ? await loadMyCoupons() : [];
  const claimContext = gift.order ? await loadGiftClaimContext(giftId, auth.user.id) : null;
  return <GiftDetail actorId={auth.user.id} initialGift={gift} coupons={coupons} initialClaimContext={claimContext} />;
}
