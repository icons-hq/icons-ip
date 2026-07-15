import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Settings } from '@/components/screens/Settings';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';

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

  let avatarUrl: string | null = null;
  if (auth.profile?.avatar_path) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.storage
        .from('user-uploads')
        .createSignedUrl(auth.profile.avatar_path, 3600);
      if (!error) avatarUrl = data?.signedUrl ?? null;
    } catch {
      avatarUrl = null;
    }
  }

  return (
    <Settings
      avatarUrl={avatarUrl}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      initialMarketing={auth.profile?.consents?.marketing === true}
      isConfigured={auth.isConfigured}
      nickname={auth.profile?.nickname ?? ''}
    />
  );
}
