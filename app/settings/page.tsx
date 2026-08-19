import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Settings } from '@/components/screens/Settings';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getAccountDeletionPresentation } from '@/lib/account-deletion.server';
import { UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION } from '@/lib/account-deletion';
import { getProfileAvatarPresentation } from '@/lib/profile-avatar.server';

export const metadata: Metadata = {
  title: '설정 — ICONS',
  description: '프로필을 편집하고 계정 정보와 마케팅 정보 수신 동의를 관리하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();

  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings')}`);
  }

  if (auth.user && !isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath('/settings'));
  }

  const nickname = auth.profile?.nickname ?? '';
  const [avatar, accountDeletion] = await Promise.all([
    getProfileAvatarPresentation({
      avatarPath: auth.profile?.avatar_path ?? null,
      nickname,
    }),
    auth.isConfigured
      ? getAccountDeletionPresentation()
      : UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION,
  ]);

  return (
    <Settings
      accountDeletion={accountDeletion}
      accountDeletionRequestKey={crypto.randomUUID()}
      avatarInitial={avatar.avatarInitial}
      avatarUrl={avatar.avatarUrl}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      initialMarketing={auth.profile?.consents?.marketing === true}
      isConfigured={auth.isConfigured}
      nickname={nickname}
    />
  );
}
