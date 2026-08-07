import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { Admin } from '@/components/admin/Admin';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { getAdminCurations } from '@/lib/admin/curations.server';
import { getAdminDrawTicketGrants } from '@/lib/admin/draw-ticket-grants.server';
import { getAdminInsights } from '@/lib/admin/insights.server';
import { getAdminModerationRecords } from '@/lib/admin/moderation.server';
import { getAdminMemberSummaries } from '@/lib/admin/members.server';
import { getAdminNotificationConsoleData } from '@/lib/admin/notifications.server';
import { normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { getAdminOrderRecords } from '@/lib/admin/orders.server';
import { getAdminProfileRecords } from '@/lib/admin/roles.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadEmailDeliveries } from '@/lib/email/deliveries.server';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const orderFilters = normalizeAdminOrderFilters(query);
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin')}`);
  }

  if (!auth.isStaff) {
    notFound();
  }

  const [catalog, records, moderation, insights, members, profiles, orders, notificationConsole, curations, drawTicketGrants, emailDeliveries] = await Promise.all([
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
    getAdminCatalogRecords(),
    getAdminModerationRecords(),
    getAdminInsights(),
    getAdminMemberSummaries(''),
    auth.role === 'admin' ? getAdminProfileRecords() : Promise.resolve([]),
    getAdminOrderRecords(orderFilters),
    getAdminNotificationConsoleData(),
    getAdminCurations(),
    getAdminDrawTicketGrants(),
    loadEmailDeliveries(),
  ]);

  return (
    <Admin
      admin={{
        id: auth.user.id,
        email: auth.user.email,
        role: auth.role ?? 'staff',
      }}
      catalog={catalog}
      drawTicketGrants={drawTicketGrants}
      emailDeliveries={emailDeliveries}
      insights={insights}
      initialSection={query.section === 'orders' ? 'orders' : query.section === 'good' ? 'good' : query.section === 'ticket' ? 'ticket' : query.section === 'pool' ? 'pool' : query.section === 'policy' ? 'policy' : query.section === 'grants' ? 'grants' : query.section === 'game' ? 'game' : query.section === 'curations' ? 'curations' : query.section === 'notifications' ? 'notifications' : query.section === 'members' ? 'members' : 'overview'}
      members={members}
      moderation={moderation}
      notificationConsole={notificationConsole}
      orders={orders}
      policyDraftActiveFrom={new Date().toISOString()}
      policyDraftId={randomUUID()}
      policyOperationId={randomUUID()}
      poolDraftActiveFrom={new Date().toISOString()}
      poolDraftId={randomUUID()}
      poolOddsOperationId={randomUUID()}
      poolOperationId={randomUUID()}
      profiles={profiles}
      records={records}
      stockAdjustmentId={randomUUID()}
      ticketDraftId={randomUUID()}
      ticketOperationId={randomUUID()}
      gameEndOperationId={randomUUID()}
      gameOperationId={randomUUID()}
      notificationOperationId={randomUUID()}
      curationDraftActiveFrom={new Date().toISOString()}
      curationDraftId={randomUUID()}
      curationOperationId={randomUUID()}
      curations={curations}
      grantOperationId={randomUUID()}
    />
  );
}
