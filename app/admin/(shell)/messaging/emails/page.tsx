import { EmailDeliverySection } from '@/components/admin/sections/EmailDeliverySection';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadEmailDeliveries } from '@/lib/email/deliveries.server';

export default async function AdminMessagingEmailsPage() {
  await requireAdminScreenAccess('/admin/messaging/emails');

  const deliveries = await loadEmailDeliveries();

  return <EmailDeliverySection deliveries={deliveries} />;
}
