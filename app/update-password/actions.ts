'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AUTH_CALLBACK_PATH,
  AUTH_NEXT_COOKIE_NAME,
  AUTH_RECOVERY_PROOF_COOKIE_NAME,
  PASSWORD_RECOVERY_REQUIRED_MESSAGE,
  PASSWORD_UNAVAILABLE_FOR_SOCIAL_ACCOUNT_MESSAGE,
  passwordResetSuccessLoginPath,
  passwordUpdateErrorMessage,
  safeNextPath,
  UPDATE_PASSWORD_PATH,
} from '@/lib/auth/onboarding';
import { passwordUpdateAccess, type PasswordUpdateAccess } from '@/lib/auth/recovery.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export interface UpdatePasswordActionState {
  message?: string;
  /**
   * 저장을 거절한 이유 — 화면은 폼 대신 해당 안내로 바꾼다. recovery 콜백을 거친 세션이 아니거나 증명이
   * 만료됐으면 재설정 메일 안내, 이메일 로그인 수단이 없는 소셜 전용 계정이면 SNS 로그인 안내다.
   */
  blocked?: Exclude<PasswordUpdateAccess, 'allowed'>;
  errors?: {
    password?: string;
    passwordConfirmation?: string;
    form?: string;
  };
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function updatePasswordAction(
  _state: UpdatePasswordActionState,
  formData: FormData,
): Promise<UpdatePasswordActionState> {
  const password = readString(formData, 'password');
  const passwordConfirmation = readString(formData, 'passwordConfirmation');
  const next = safeNextPath(formData.get('next'));
  const errors: NonNullable<UpdatePasswordActionState['errors']> = {};

  if (!password) errors.password = '새 비밀번호를 입력해주세요.';
  if (!passwordConfirmation) errors.passwordConfirmation = '새 비밀번호 확인을 입력해주세요.';
  if (password && passwordConfirmation && password !== passwordConfirmation) {
    errors.passwordConfirmation = '새 비밀번호가 일치하지 않습니다.';
  }
  if (Object.keys(errors).length > 0) return { errors };

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return { errors: { form: 'Supabase 환경변수를 설정한 뒤 비밀번호를 변경할 수 있습니다.' } };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return {
      errors: {
        form: passwordUpdateErrorMessage(userError ?? { code: 'session_not_found' }),
      },
    };
  }

  const cookieStore = await cookies();
  const access = await passwordUpdateAccess(
    supabase,
    userData.user,
    cookieStore.get(AUTH_RECOVERY_PROOF_COOKIE_NAME)?.value,
  );
  if (access !== 'allowed') {
    return {
      blocked: access,
      errors: {
        form: access === 'no_email_identity'
          ? PASSWORD_UNAVAILABLE_FOR_SOCIAL_ACCOUNT_MESSAGE
          : PASSWORD_RECOVERY_REQUIRED_MESSAGE,
      },
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { errors: { form: passwordUpdateErrorMessage(updateError) } };
  }

  cookieStore.set(AUTH_NEXT_COOKIE_NAME, '', { path: AUTH_CALLBACK_PATH, maxAge: 0 });
  cookieStore.set(AUTH_RECOVERY_PROOF_COOKIE_NAME, '', { path: UPDATE_PASSWORD_PATH, maxAge: 0 });

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
  if (signOutError) {
    const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' });
    return {
      message: localSignOutError
        ? '비밀번호는 변경되었습니다. 다만 로그아웃을 완료하지 못했습니다. 이 브라우저를 닫아주세요. 다시 접속할 때는 새 비밀번호를 사용해주세요.'
        : '비밀번호는 변경되었습니다. 이 브라우저는 로그아웃했지만 다른 기기의 로그아웃을 완료하지 못했습니다. 새 비밀번호로 다시 로그인해주세요.',
    };
  }

  redirect(passwordResetSuccessLoginPath(next));
}
