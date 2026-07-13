import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Settings } from '@/components/screens/Settings';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = {
  title: '설정 — ICONS',
  description: '계정 정보를 확인하고 마케팅 정보 수신 동의를 관리하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();

  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings')}`);
  }

  if (auth.user && !isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath('/settings'));
  }

  return (
    <Settings
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      initialMarketing={auth.profile?.consents?.marketing === true}
      isConfigured={auth.isConfigured}
      nickname={auth.profile?.nickname ?? ''}
    />
  );
}
