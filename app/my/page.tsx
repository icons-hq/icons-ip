import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyPage } from '@/components/screens/MyPage';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getProfileAvatarPresentation } from '@/lib/profile-avatar.server';

export const metadata: Metadata = {
  title: '마이페이지 — ICONS',
  description: '주문과 티켓, 카드 컬렉션, 계정 설정을 한곳에서 확인하세요.',
  robots: { index: false, follow: false },
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my'));

  const nickname = auth.profile?.nickname ?? '';
  const avatar = await getProfileAvatarPresentation({
    avatarPath: auth.profile?.avatar_path ?? null,
    nickname,
  });

  return (
    <MyPage
      avatarInitial={avatar.avatarInitial}
      avatarUrl={avatar.avatarUrl}
      nickname={nickname}
    />
  );
}
