import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyPage } from '@/components/screens/MyPage';
import type { MypageLoyaltySummary } from '@/components/wc/MypageShell';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadLoyaltyStatus } from '@/lib/coupons.server';
import { loyaltyGradeLabel } from '@/lib/loyalty';
import { loadMypageDashboard } from '@/lib/mypage-dashboard.server';
import { loadPublicDetailExperienceConfig } from '@/lib/product-detail-experiences.server';
import { getProfileAvatarPresentation } from '@/lib/profile-avatar.server';

export const metadata: Metadata = {
  title: '마이페이지 — ICONS',
  description: '주문과 티켓, 카드 컬렉션, 계정 설정을 한곳에서 확인하세요.',
  robots: { index: false, follow: false },
};

/* 대시보드(L6 · MY-02·MY-04)는 블록마다 기존 서버 조회를 함께 읽는다 — 서로를 기다릴 이유가 없다.
   최근 본 굿즈 블록은 상세 경험 interests 스위치를 따른다(LD-16): 꺼져 있으면 블록을 그리지 않는다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my'));

  const nickname = auth.profile?.nickname ?? '';
  const [avatar, loyaltyStatus, dashboard, discovery] = await Promise.all([
    getProfileAvatarPresentation({
      avatarPath: auth.profile?.avatar_path ?? null,
      nickname,
    }),
    loadLoyaltyStatus(),
    loadMypageDashboard(auth.user.id),
    loadPublicDetailExperienceConfig(),
  ]);

  const loyalty: MypageLoyaltySummary | null = loyaltyStatus
    ? {
      grade: loyaltyStatus.grade,
      label: loyaltyGradeLabel(loyaltyStatus.grade),
      nextNote: loyaltyStatus.nextNote,
    }
    : null;

  return (
    <MyPage
      avatarInitial={avatar.avatarInitial}
      avatarUrl={avatar.avatarUrl}
      dashboard={dashboard}
      loyalty={loyalty}
      nickname={nickname}
      recentGoodsEnabled={discovery.interests}
      viewerId={auth.user.id}
    />
  );
}
