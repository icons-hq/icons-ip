import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GiftReceive } from '@/components/screens/gifts/GiftReceive';
import { GiftEmpty } from '@/components/gifts/GiftParts';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { loadGiftInvitation } from '@/lib/gifts.server';
export const metadata: Metadata = { title: '선물 받기 — ICONS' };
export default async function Page() {
  const auth = await getCurrentAuthState(); if (!auth.user) redirect('/login?next=%2Fgifts%2Freceive%2Fsession');
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/gifts/receive/session'));
  const invitation = await loadGiftInvitation();
  if (!invitation) return <main className="wc-root"><div className="wc-container wc-gifts"><GiftEmpty title="이 선물 링크를 사용할 수 없어요"><p>이미 수락했거나 기한이 지난 링크예요. 보낸 사람에게 새 링크를 요청해주세요.</p><Link href="/gifts">선물함 확인</Link></GiftEmpty></div></main>;
  return <GiftReceive actorId={auth.user.id} actorLabel={auth.profile?.nickname ?? '내 계정'} invitation={invitation} />;
}
