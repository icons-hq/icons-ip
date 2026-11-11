import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PasswordRecoveryRequired } from '@/components/screens/PasswordRecoveryRequired';
import { RecoverySessionBridge } from '@/components/screens/RecoverySessionBridge';
import { SocialAccountPasswordNotice } from '@/components/screens/SocialAccountPasswordNotice';
import { UpdatePassword } from '@/components/screens/UpdatePassword';
import {
  passwordResetErrorLoginPath,
  safeNextPath,
  updatePasswordPath,
} from '@/lib/auth/onboarding';
import { getPasswordUpdateState } from '@/lib/auth/server';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: '새 비밀번호 설정 — ICONS',
  description: 'ICONS 계정의 새 비밀번호를 설정합니다.',
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const sessionReady = firstParam(params.session_ready) === '1';
  const { access, user } = await getPasswordUpdateState();

  if (!user) {
    if (sessionReady) return <RecoverySessionBridge next={next} />;
    redirect(passwordResetErrorLoginPath('session_not_found', next));
  }
  if (sessionReady) redirect(updatePasswordPath(next));

  // 로그인 세션만으로는 폼을 열지 않는다 — recovery 콜백을 거친 그 세션이고, 이메일 로그인 수단이 있는 계정일 때만 받는다.
  if (access === 'no_email_identity') return <SocialAccountPasswordNotice next={next} />;
  if (access === 'recovery_required') return <PasswordRecoveryRequired email={user.email} next={next} />;

  return <UpdatePassword email={user.email} next={next} />;
}
