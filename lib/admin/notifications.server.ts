import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import {
  adminNotificationAudienceFromRow,
  adminNotificationHistoryFromRow,
  type AdminNotificationAudience,
  type AdminNotificationAudienceRow,
  type AdminNotificationConsoleData,
  type AdminNotificationHistoryRow,
  type AdminNotificationScope,
} from './notifications';

interface IpRow {
  id: string;
  title: string;
}

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffLoader() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(loginPath());
  if (!auth.isStaff) notFound();
}

function firstRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length < 1) return null;
  return data[0] as T;
}

export async function getAdminNotificationConsoleData(): Promise<AdminNotificationConsoleData> {
  await requireStaffLoader();

  const supabase = await createClient();
  const [ipsResult, allEstimateResult, historyResult] = await Promise.all([
    supabase.from('ips').select('id,title').order('title', { ascending: true }),
    supabase.rpc('admin_estimate_notification_recipients', {
      target_ip_id: null,
      target_scope: 'all',
    }),
    supabase.rpc('admin_list_notification_history', {
      target_limit: 20,
      target_offset: 0,
    }),
  ]);

  if (ipsResult.error) throw new Error('Failed to load admin notification IPs');
  if (allEstimateResult.error) throw new Error('Failed to load admin notification audiences');
  if (historyResult.error) throw new Error('Failed to load admin notification history');

  const allRow = firstRow<AdminNotificationAudienceRow>(allEstimateResult.data);
  if (!allRow) throw new Error('Failed to load admin notification audiences');

  const ipRows = (ipsResult.data ?? []) as IpRow[];
  const ipEstimateResults = await Promise.all(ipRows.map((ip) => (
    supabase.rpc('admin_estimate_notification_recipients', {
      target_ip_id: ip.id,
      target_scope: 'ip_followers' satisfies AdminNotificationScope,
    })
  )));

  const audiences: AdminNotificationAudience[] = [adminNotificationAudienceFromRow(allRow)];
  for (const result of ipEstimateResults) {
    if (result.error) throw new Error('Failed to load admin notification audiences');
    const row = firstRow<AdminNotificationAudienceRow>(result.data);
    if (!row) throw new Error('Failed to load admin notification audiences');
    audiences.push(adminNotificationAudienceFromRow(row));
  }

  return {
    audiences,
    history: ((historyResult.data ?? []) as AdminNotificationHistoryRow[])
      .map(adminNotificationHistoryFromRow),
  };
}
