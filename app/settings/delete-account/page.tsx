import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AccountDeletionPanel } from '@/components/account/AccountDeletionPanel';
import type { AccountDeletionPresentation } from '@/lib/account-deletion';
import { getAccountDeletionPresentation } from '@/lib/account-deletion.server';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = {
  title: '회원 탈퇴 — ICONS',
  description: '진행 중인 의무를 확인하고 회원 탈퇴를 신청합니다.',
};

const unavailablePresentation: AccountDeletionPresentation = {
  preview: {
    available: false,
    eligible: false,
    blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
  },
  status: {
    status: 'not_requested',
    phase: 'none',
    nextAction: '/settings',
    blockers: [],
  },
};

export default async function Page() {
  await connection();
  const auth = await getCurrentAuthState();
  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings/delete-account')}`);
  }

  const presentation = auth.isConfigured
    ? await getAccountDeletionPresentation()
    : unavailablePresentation;

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '110px 0 80px' }}>
      <div className="rise" style={{ width: 'min(520px, 92vw)' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>
          회원 탈퇴
        </h1>
        <div style={{ marginTop: 24 }}>
          <AccountDeletionPanel
            presentation={presentation}
            requestKey={crypto.randomUUID()}
          />
        </div>
      </div>
    </main>
  );
}
