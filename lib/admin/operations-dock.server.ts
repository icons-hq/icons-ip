import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminAlertCategory, AdminAlertFilterState, AdminAlertPage, AdminOperationTask } from './operations-dock';

export async function getAdminOperationAlerts(category: AdminAlertCategory, state: AdminAlertFilterState, before?: string, beforeId?: string): Promise<AdminAlertPage> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_operation_alerts', { p_category: category, p_state: state, p_before: before || null, p_before_id: beforeId || null, p_limit: 30 });
  if (error || !data) throw new Error('운영 알림을 불러오지 못했습니다.');
  return data as AdminAlertPage;
}
export async function getAdminOperationTasks(): Promise<AdminOperationTask[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_operation_tasks');
  if (error || !Array.isArray(data)) throw new Error('처리할 업무를 불러오지 못했습니다.');
  return data as AdminOperationTask[];
}
