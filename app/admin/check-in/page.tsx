import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketCheckIn } from '@/components/admin/check-in/TicketCheckIn';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export const metadata: Metadata = {
  title: '티켓 검표 — ICONS',
  robots: { index: false, follow: false },
};

export default async function AdminCheckInPage() {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin/check-in')}`);
  }
  if (!auth.isStaff) notFound();

  return <TicketCheckIn />;
}
