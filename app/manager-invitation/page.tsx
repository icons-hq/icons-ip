import type { Metadata } from 'next';
import { ManagerInvitation } from '@/components/screens/ManagerInvitation';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = { title: '매니저 초대 | ICONS', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ManagerInvitationPage() {
  const auth = await getCurrentAuthState();
  return <ManagerInvitation signedIn={Boolean(auth.user)} />;
}
