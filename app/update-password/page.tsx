import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RecoverySessionBridge } from '@/components/screens/RecoverySessionBridge';
import { UpdatePassword } from '@/components/screens/UpdatePassword';
import {
  passwordResetErrorLoginPath,
  safeNextPath,
  updatePasswordPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';

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
  const auth = await getCurrentAuthState();

  if (!auth.user) {
    if (sessionReady) return <RecoverySessionBridge next={next} />;
    redirect(passwordResetErrorLoginPath('session_not_found', next));
  }
  if (sessionReady) redirect(updatePasswordPath(next));

  return <UpdatePassword next={next} />;
}
