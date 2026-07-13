'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { mergeMarketingConsent } from '@/lib/settings';
import { createClient } from '@/lib/supabase/server';

export interface SettingsActionState {
  errors?: {
    form?: string;
  };
  message?: string;
}

const SETTINGS_PATH = '/settings';

export async function updateMarketingConsentAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const marketing = formData.get('marketing') === 'on';

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured) {
    return { errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' } };
  }
  if (!auth.user) {
    redirect(`/login?next=${encodeURIComponent(SETTINGS_PATH)}`);
  }
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(SETTINGS_PATH));
  }

  // terms·privacy는 클라이언트 입력을 신뢰하지 않고 DB 현재 값을 보존한다
  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ consents: mergeMarketingConsent(auth.profile?.consents, marketing) })
    .eq('id', auth.user.id)
    .select('id')
    .single();

  if (error) return { errors: { form: '설정을 저장하지 못했습니다. 다시 시도해주세요.' } };

  revalidatePath(SETTINGS_PATH);
  return { message: '마케팅 정보 수신 동의 설정을 저장했어요.' };
}
