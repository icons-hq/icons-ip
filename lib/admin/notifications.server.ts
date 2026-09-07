import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getAdminIpOptions } from '@/lib/admin/catalog-list.server';
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
  /* IP 별 수신자 수는 **고른 뒤에** 센다(`estimateAdminNotificationAudience`).
     전에는 IP 를 전부 읽고 IP 마다 추정 RPC 를 한 번씩 쐈다 — 1만 개면 왕복 1만 번이고,
     그 앞의 select 는 PostgREST 상한 1,000 에서 조용히 잘려 나머지 IP 는 고를 수조차 없었다. */
  const [allEstimateResult, historyResult, ipOptions] = await Promise.all([
    supabase.rpc('admin_estimate_notification_recipients', {
      target_ip_id: null,
      target_scope: 'all',
    }),
    supabase.rpc('admin_list_notification_history', {
      target_limit: 20,
      target_offset: 0,
    }),
    getAdminIpOptions(),
  ]);

  if (allEstimateResult.error) throw new Error('Failed to load admin notification audiences');
  if (historyResult.error) throw new Error('Failed to load admin notification history');

  const allRow = firstRow<AdminNotificationAudienceRow>(allEstimateResult.data);
  if (!allRow) throw new Error('Failed to load admin notification audiences');

  return {
    allAudience: adminNotificationAudienceFromRow(allRow),
    ipOptions,
    history: ((historyResult.data ?? []) as AdminNotificationHistoryRow[])
      .map(adminNotificationHistoryFromRow),
  };
}

/** 고른 IP 하나의 수신자 수. 화면이 IP 를 고를 때마다 부른다. */
export async function estimateAdminNotificationAudience(
  ipId: string,
): Promise<AdminNotificationAudience> {
  await requireStaffLoader();

  const supabase = await createClient();
  const result = await supabase.rpc('admin_estimate_notification_recipients', {
    target_ip_id: ipId,
    target_scope: 'ip_followers' satisfies AdminNotificationScope,
  });
  if (result.error) throw new Error('Failed to load admin notification audiences');

  const row = firstRow<AdminNotificationAudienceRow>(result.data);
  if (!row) throw new Error('Failed to load admin notification audiences');
  return adminNotificationAudienceFromRow(row);
}
