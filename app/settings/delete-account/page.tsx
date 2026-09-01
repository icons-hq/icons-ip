import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AccountDeletionPanel } from '@/components/account/AccountDeletionPanel';
import { UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION } from '@/lib/account-deletion';
import { getAccountDeletionPresentation } from '@/lib/account-deletion.server';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = {
  title: '회원 탈퇴 — ICONS',
  description: '진행 중인 의무를 확인하고 회원 탈퇴를 신청합니다.',
};

export default async function Page() {
  await connection();
  const auth = await getCurrentAuthState();
  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings/delete-account')}`);
  }

  const presentation = auth.isConfigured
    ? await getAccountDeletionPresentation()
    : UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION;

  return (
    /* 파괴적 확인 흐름 — aside 없는 단일 과업 지면으로 집중시킨다(flat-auth-form 문법). */
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <h1 className="wc-auth__title wc-auth__title--sub">회원 탈퇴</h1>
        <AccountDeletionPanel
          presentation={presentation}
          requestKey={crypto.randomUUID()}
        />
      </div>
    </main>
  );
}
