import { notFound, redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyMarketingTestReceipt } from '@/lib/admin/marketing-messages.server';
import { isUuid } from '@/lib/uuid';
import { CustomerMarketingMessage } from '@/components/screens/CustomerMarketingMessage';
export const metadata = { title: '운영자 테스트 알림 — ICONS', robots: { index: false, follow: false } };
export default async function MarketingTestPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params; if (!isUuid(receiptId)) notFound();
  const auth = await getCurrentAuthState(); if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/notifications/marketing-test/${receiptId}`)}`);
  const message = await loadMyMarketingTestReceipt(receiptId); if (!message) notFound(); return <CustomerMarketingMessage message={message} test />;
}
