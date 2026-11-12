'use server';
import { isUuid } from '@/lib/uuid';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { adminAlertCategory, adminAlertFilterState } from '@/lib/admin/operations-dock';

export async function updateAdminOperationAlertsAction(input: { action: 'read' | 'hide' | 'restore'; ids: string[] | null; through: string; category: string; state: string }): Promise<{ error?: string }> {
  if (!await requireAdminActionAccess('/admin', { capability: 'home' })) return { error: '운영 알림을 변경할 권한이 없습니다.' };
  if (!input || !['read', 'hide', 'restore'].includes(input.action) || !Number.isFinite(Date.parse(input.through)) || adminAlertCategory(input.category) !== input.category || adminAlertFilterState(input.state) !== input.state || (input.ids !== null && (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || input.ids.some(id => !isUuid(id))))) return { error: '알림 처리 대상을 확인해주세요.' };
  const client = await createClient();
  const { error } = await client.rpc('admin_update_operation_alerts', { p_action: input.action, p_ids: input.ids, p_through: input.through, p_category: adminAlertCategory(input.category), p_state: adminAlertFilterState(input.state) });
  return error ? { error: '알림을 변경하지 못했습니다. 다시 시도해주세요.' } : {};
}
export async function setAdminOperationAlertBadgeAction(enabled: boolean): Promise<{ error?: string }> {
  if (!await requireAdminActionAccess('/admin', { capability: 'home' })) return { error: '운영 알림을 변경할 권한이 없습니다.' };
  if (typeof enabled !== 'boolean') return { error: '알림 설정을 확인해주세요.' };
  const client = await createClient();
  const { error } = await client.rpc('admin_set_operation_alert_badge', { p_enabled: enabled });
  return error ? { error: '알림 설정을 저장하지 못했습니다.' } : {};
}
