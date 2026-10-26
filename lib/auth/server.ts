import 'server-only';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import {
  AUTH_RECOVERY_PROOF_COOKIE_NAME,
  type OnboardingConsents,
  type ProfileForOnboarding,
} from './onboarding';
import { hasPasswordRecoveryProof } from './recovery.server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface ProfileRow {
  email: string | null;
  nickname: string | null;
  birth_date: string | null;
  avatar_path: string | null;
  consents: OnboardingConsents | null;
  onboarded_at: string | null;
  role: 'user' | 'staff' | 'admin' | null;
  suspended_at: string | null;
}

export interface CurrentAuthState {
  isConfigured: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  profile: ProfileForOnboarding | null;
  isStaff: boolean;
}

export async function getProfileForUser(supabase: SupabaseServerClient, userId: string): Promise<ProfileForOnboarding | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('email,nickname,birth_date,avatar_path,consents,onboarded_at,role,suspended_at')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (error || !data) return null;
  return data;
}

export async function getCurrentAuthState(): Promise<CurrentAuthState> {
  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { isConfigured: false, user: null, profile: null, isStaff: false };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;

  if (error || !user) return { isConfigured: true, user: null, profile: null, isStaff: false };

  const profile = await getProfileForUser(supabase, user.id);

  return {
    isConfigured: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    profile,
    isStaff: !profile?.suspended_at && (profile?.role === 'staff' || profile?.role === 'admin'),
  };
}

/** 지금 세션이 recovery 콜백을 거친 그 세션인지(/update-password 화면용). 서버 action은 같은 판정을 자기 클라이언트로 한다. */
export async function hasCurrentPasswordRecoveryProof(): Promise<boolean> {
  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return false;

  const [supabase, cookieStore] = await Promise.all([createClient(), cookies()]);
  return hasPasswordRecoveryProof(supabase, cookieStore.get(AUTH_RECOVERY_PROOF_COOKIE_NAME)?.value);
}
